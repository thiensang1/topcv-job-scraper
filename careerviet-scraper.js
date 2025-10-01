const fs = require('fs');
const puppeteer = require('puppeteer');
const axios = require('axios');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán"; // Sửa để tránh rỗng
const MAX_PAGES = 537; // Dựa trên trang cuối cùng
const FAKE_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0'
];
const SEARCH_BASE_URL = "https://careerviet.vn/viec-lam/tat-ca-viec-lam-trang";

// --- HÀM LẤY PROXY ---
async function getProxy(apiKey, apiEndpoint) {
    if (!apiKey || !apiEndpoint) {
        console.error("Cảnh báo: Không có thông tin API Proxy. Chạy không cần proxy.");
        return null;
    }
    try {
        console.error("-> [Điệp viên] Đang yêu cầu một danh tính proxy MỚI từ API...");
        const response = await axios.get(apiEndpoint, {
            params: { key: apiKey, region: 'random' },
            timeout: 20000
        });
        if (response.data?.success && response.data?.data?.http) {
            const [host, port] = response.data.data.http.split(':');
            console.error(`-> [Điệp viên] Đã nhận proxy mới thành công: ${host}:${port}`);
            return { host, port };
        }
        throw new Error(`Phản hồi không như mong đợi: ${JSON.stringify(response.data)}`);
    } catch (error) {
        console.error(`-> [Điệp viên] Lỗi nghiêm trọng khi lấy proxy: ${error.message}`);
        return null;
    }
}

// --- HÀM HELPER ---
function setOutput(name, value) {
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    }
}

async function getBrowserContext(proxy) {
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--window-size=1920,1080'
    ];
    if (proxy) {
        args.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
        console.error(`-> Sử dụng proxy mới: http://${proxy.host}:${proxy.port}`);
    }

    const browser = await puppeteer.launch({
        headless: true,
        args,
        executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome'
    });
    const page = await browser.newPage();
    
    // Ngẫu nhiên User-Agent
    const userAgent = FAKE_USER_AGENTS[Math.floor(Math.random() * FAKE_USER_AGENTS.length)];
    await page.setUserAgent(userAgent);
    
    // Tối ưu viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Chặn request không cần thiết (Netcore)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url();
        if (url.includes('netcoresmartech.com') || url.includes('wntoken')) {
            req.abort();
        } else {
            req.continue();
        }
    });
    
    return { browser, page };
}

async function scrapeHTML(page, pageNum) {
    const url = `${SEARCH_BASE_URL}-${pageNum}-vi.html`;
    console.error(` -> Đang cào dữ liệu từ trang ${url}...`);
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Chờ explicit cho job list
        try {
            await page.waitForSelector('.job-item, .job__list--item, .list-jobs .item, [class*="job"], .search-result-item, .matching-scores', { timeout: 15000 });
        } catch (e) {
            console.error(' -> Không tìm thấy selector job trên trang');
        }
        
        // Cuộn trang để tải lazy content
        await page.evaluate(async () => {
            await new Promise(resolve => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= document.body.scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        
        // Trích xuất dữ liệu
        const jobs = await page.evaluate((keyword) => {
            const jobElements = document.querySelectorAll('.job-item, .job__list--item, .list-jobs .item, [class*="job"], .search-result-item, .matching-scores');
            console.log(` -> Tìm thấy ${jobElements.length} phần tử job tiềm năng`);

            return Array.from(jobElements).map(el => {
                return {
                    'Tên công việc': el.JOB_TITLE,
                    'Tên công ty': el.EMP_NAME,
                    'Nơi làm việc': el.LOCATION_NAME_ARR.join(', '),
                    'Mức lương': el.JOB_SALARY_STRING,
                    'Ngày đăng tin': el.JOB_ACTIVEDATE,
                    'Ngày hết hạn': el.JOB_LASTDATE,
                    'Link': el.LINK_JOB
                };
            });
        }, TARGET_KEYWORD);

        if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
            throw new Error("Không tìm thấy dữ liệu việc làm hoặc dữ liệu rỗng.");
        }

        console.error(` -> Phân tích thành công! Tìm thấy ${jobs.length} tin tuyển dụng.`);
        
        return jobs;
    } catch (error) {
        console.error(`Lỗi nghiêm trọng trong chiến dịch: ${error.message}`);
        return [];
    }
}

// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    let allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";
    let pageNum = 1;
    const jobIds = new Set();
    let browser, page;
    let proxy = null;
    const apiKey = process.env.PROXY_API_KEY;
    const apiEndpoint = process.env.PROXY_API_ENDPOINT;

    try {
        console.error(`--- Bắt đầu khai thác dữ liệu CareerViet cho từ khóa: "${TARGET_KEYWORD}" ---`);

        // Lấy proxy ban đầu nếu có
        proxy = await getProxy(apiKey, apiEndpoint);
        ({ browser, page } = await getBrowserContext(proxy));

        while (pageNum <= MAX_PAGES) {
            const jobs = await scrapeHTML(page, pageNum);
            if (jobs.length === 0) {
                console.error(` -> Không còn dữ liệu ở trang ${pageNum}. Kết thúc phân trang.`);
                break;
            }

            const newJobs = jobs.map(job => ({
                'Tên công việc': job['Tên công việc'] || 'N/A',
                'Tên công ty': job['Tên công ty'] || 'N/A',
                'Nơi làm việc': job['Nơi làm việc'] || 'N/A',
                'Mức lương': job['Mức lương'] || 'N/A',
                'Ngày đăng tin': job['Ngày đăng tin'] || 'N/A',
                'Ngày hết hạn': job['Ngày hết hạn'] || 'N/A',
                'Link': job['Link'] || 'N/A'
            }));

            allJobs = [...allJobs, ...newJobs];
            pageNum++;

            // Lấy proxy mới mỗi 20 trang
            if (pageNum % 20 === 0) {
                console.error(` -> Lấy proxy mới cho trang ${pageNum}...`);
                proxy = await getProxy(apiKey, apiEndpoint);
                await browser.close();
                ({ browser, page } = await getBrowserContext(proxy));
            }
        }

    } catch (error) {
        console.error(`Lỗi nghiêm trọng trong chiến dịch: ${error.message}`);
    } finally {
        if (browser) await browser.close();
    }

    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: 'Asia/Ho_Chi_Minh'
        }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        
        finalFilename = `data/careerviet_${TARGET_KEYWORD.replace(/\s/g, '-')}_${timestamp}.csv`;
        jobsCount = allJobs.length;
        
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${jobsCount} tin việc làm từ CareerViet vào file ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }

    setOutput('jobs_count', jobsCount);
    setOutput('final_filename', finalFilename);
})();
