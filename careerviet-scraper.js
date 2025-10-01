const fs = require('fs');
const puppeteer = require('puppeteer');
const axios = require('axios'); // Thêm axios cho getProxy
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "";
const MAX_PAGES = 537; // Dựa trên trang cuối cùng
const RETRY_COUNT = 2;
const FAKE_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0'
];
const SEARCH_BASE_URL = "https://careerviet.vn/viec-lam/tat-ca-viec-lam-trang";

// --- HÀM HELPER ---
function setOutput(name, value) {
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    }
}

async function getProxy(apiKey, apiEndpoint) {
    if (!apiKey || !apiEndpoint) {
        console.error("Cảnh báo: Không có thông tin API Proxy. Chạy không cần proxy.");
        return null;
    }
    try {
        console.error("-> [Proxy] Đang yêu cầu proxy mới từ API...");
        const response = await axios.get(apiEndpoint, {
            params: { key: apiKey, region: 'random' },
            timeout: 20000
        });
        if (response.data?.success && response.data?.data?.http) {
            const [host, port] = response.data.data.http.split(':');
            console.error(`-> [Proxy] Đã nhận proxy mới: ${host}:${port}`);
            return { host, port };
        }
        throw new Error(`Phản hồi API proxy không hợp lệ: ${JSON.stringify(response.data)}`);
    } catch (error) {
        console.error(`-> [Proxy] Lỗi khi lấy proxy mới: ${error.message}`);
        return null;
    }
}

async function getBrowserContext(proxy) {
    const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--window-size=1920,1080'
    ];
    if (proxy) {
        launchArgs.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
        console.error(`-> [Proxy] Sử dụng proxy: http://${proxy.host}:${proxy.port}`);
    }

    const browser = await puppeteer.launch({
        headless: true,
        args: launchArgs,
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

async function scrapeHTML(page, pageNum, retry = 0) {
    const startTime = Date.now();
    const url = `${SEARCH_BASE_URL}-${pageNum}-vi.html`;
    console.error(`\n--- Bắt đầu trang ${pageNum} (retry ${retry}/${RETRY_COUNT}) --- URL: ${url}`);
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
        
        // Kiểm tra 404
        const pageTitle = await page.title();
        if (pageTitle.includes('không tìm thấy') || pageTitle.includes('error')) {
            console.error(` -> Trang ${pageNum} không tồn tại. Kết thúc.`);
            return { jobs: [], hasNextPage: false };
        }
        
        // Chờ job list
        try {
            await page.waitForSelector('.job-item, .job__list--item, .list-jobs .item, [class*="job"], .search-result-item, .matching-scores', { timeout: 15000 });
            console.error(` -> Job list loaded ở trang ${pageNum}`);
        } catch (e) {
            console.error(` -> Không tìm thấy job list ở trang ${pageNum}, chờ thêm 5s...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        // Cuộn trang 3 lần
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Debug cho trang đầu, retry, và lỗi
        if (pageNum <= 2 || retry > 0) {
            await page.screenshot({ path: `debug_screenshot_page_${pageNum}.png`, fullPage: true });
            const htmlContent = await page.content();
            fs.writeFileSync(`debug_html_page_${pageNum}.html`, htmlContent);
            console.error(` -> Đã lưu debug cho trang ${pageNum} (HTML: ${htmlContent.length} ký tự)`);
        }

        const jobs = await page.evaluate((keyword) => {
            const jobElements = document.querySelectorAll('.job-item, .job__list--item, .list-jobs .item, [class*="job"], .search-result-item, .matching-scores');
            console.log(` -> Tìm thấy ${jobElements.length} phần tử job tiềm năng ở trang ${pageNum}`);
            
            return Array.from(jobElements).map((el, index) => {
                const titleEl = el.querySelector('h3 a, .job-title a, .title a, a[href*="/tim-viec-lam/"]');
                const title = titleEl ? titleEl.textContent.trim() : 'N/A';
                
                const companyEl = el.querySelector('.company-name, .job-company, .company a, [class*="company"]');
                const company = companyEl ? companyEl.textContent.trim() : 'N/A';
                
                const locationEl = el.querySelector('.location, .job-location, .address, [class*="location"]');
                const location = locationEl ? locationEl.textContent.trim() : 'N/A';
                
                const salaryEl = el.querySelector('.salary, .job-salary, .salary-text, [class*="salary"]');
                const salary = salaryEl ? salaryEl.textContent.trim() : 'N/A';
                
                const activeDateEl = el.querySelector('.date-posted, .job-date, .posted-date, [class*="date"]');
                const activeDate = activeDateEl ? activeDateEl.textContent.trim() : 'N/A';
                
                const expiryDateEl = el.querySelector('.deadline, .expiry-date, .last-date, [class*="expire"]');
                const expiryDate = expiryDateEl ? expiryDateEl.textContent.trim() : 'N/A';
                
                const linkEl = el.querySelector('a[href*="/tim-viec-lam/"]') || el.querySelector('a');
                const link = linkEl ? (linkEl.href.startsWith('http') ? linkEl.href : 'https://careerviet.vn' + linkEl.getAttribute('href')) : 'N/A';
                
                const jobId = link.match(/\.([0-9A-F]{8})\.html$/)?.[1] || `job_${pageNum}_${index}`;
                
                return { title, company, location, salary, activeDate, expiryDate, link, jobId };
            }).filter(job => job.title.toLowerCase().includes(keyword.toLowerCase()) && job.title !== 'N/A');
        }, TARGET_KEYWORD);

        const timeTaken = Date.now() - startTime;
        console.error(` -> Kết thúc trang ${pageNum} sau ${timeTaken}ms. Job: ${jobs.length}`);
        
        // Kiểm tra nút "Next"
        const hasNextPage = await page.evaluate(() => {
            const nextButton = document.querySelector('a.next, a.pagination-next, [rel="next"], .next-page');
            return !!nextButton && !nextButton.classList.contains('disabled');
        });
        
        return { jobs, hasNextPage };
    } catch (error) {
        console.error(` -> Lỗi trang ${pageNum}: ${error.message}`);
        if (retry < RETRY_COUNT) {
            console.error(` -> Retry trang ${pageNum} lần ${retry + 1} sau 2s...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return await scrapeHTML(page, pageNum, retry + 1);
        }
        return { jobs: [], hasNextPage: false };
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
    let currentProxy = null;
    let proxyApiKey = process.env.PROXY_API_KEY;
    let proxyApiEndpoint = process.env.PROXY_API_ENDPOINT;

    try {
        ({ browser, page } = await getBrowserContext(currentProxy));
        console.error(`--- Bắt đầu khai thác dữ liệu CareerViet cho từ khóa: "${TARGET_KEYWORD}" (tối đa ${MAX_PAGES} trang) ---`);

        while (pageNum <= MAX_PAGES) {
            const { jobs, hasNextPage } = await scrapeHTML(page, pageNum);
            if (jobs.length === 0 && !hasNextPage) {
                console.error(` -> Không còn dữ liệu ở trang ${pageNum}. Kết thúc.`);
                break;
            }

            const newJobs = jobs
                .filter(job => !jobIds.has(job.jobId))
                .map(job => {
                    jobIds.add(job.jobId);
                    return {
                        'Tên công việc': job.title,
                        'Tên công ty': job.company,
                        'Nơi làm việc': job.location,
                        'Mức lương': job.salary,
                        'Ngày đăng tin': job.activeDate,
                        'Ngày hết hạn': job.expiryDate,
                        'Link': job.link
                    };
                });

            allJobs = [...allJobs, ...newJobs];
            console.error(` -> Thêm ${newJobs.length} job mới từ trang ${pageNum}. Tổng: ${allJobs.length}`);
            
            // Delay random giữa trang (10-20s) để tránh rate limit
            const betweenPagesDelay = Math.floor(Math.random() * (20000 - 10000 + 1)) + 10000;
            console.error(` -> Nghỉ ngơi ${betweenPagesDelay / 1000}s trước trang tiếp theo...`);
            await new Promise(resolve => setTimeout(resolve, betweenPagesDelay));
            
            pageNum++;

            // Lấy proxy mới mỗi 20 trang
            if (pageNum % 20 === 0 && proxyApiKey && proxyApiEndpoint) {
                console.error(` -> Đang lấy proxy mới cho trang ${pageNum}...`);
                currentProxy = await getProxy(proxyApiKey, proxyApiEndpoint);
                if (currentProxy) {
                    await browser.close();
                    ({ browser, page } = await getBrowserContext(currentProxy));
                }
            }
        }

    } catch (error) {
        console.error(`Lỗi nghiêm trọng: ${error.message}`);
        if (page) await page.screenshot({ path: 'error_screenshot_careerviet.png', fullPage: true });
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

        console.error(`\n--- BÁO CÁO --- Đã tổng hợp ${jobsCount} tin vào ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới.');
    }

    setOutput('jobs_count', jobsCount);
    setOutput('final_filename', finalFilename);
})();
