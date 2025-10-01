const fs = require('fs');
const puppeteer = require('puppeteer');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const JOBS_PER_PAGE = 30;
const MAX_PAGES = 100;
const FAKE_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0'
];
const API_JOB_SEARCH = "https://careerviet.vn/search-jobs";
const SEARCH_BASE_URL = `https://careerviet.vn/viec-lam/tim-kiem?key=${encodeURIComponent(TARGET_KEYWORD)}`;

// --- CẤU HÌNH RETRY CHO AXIOS ---
axiosRetry(axios, {
    retries: 3,
    retryDelay: (retryCount) => retryCount * 1000,
    retryCondition: (error) => error.response?.status === 429
});

// --- HÀM HELPER ---
function setOutput(name, value) {
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    }
}

async function getBrowserContext() {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--window-size=1920,1080'
        ],
        executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome'
    });
    const page = await browser.newPage();
    
    // Ngẫu nhiên User-Agent
    const userAgent = FAKE_USER_AGENTS[Math.floor(Math.random() * FAKE_USER_AGENTS.length)];
    await page.setUserAgent(userAgent);
    
    // Tối ưu viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Chặn request không cần thiết (như wntoken từ Netcore)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url();
        if (url.includes('netcoresmartech.com') || url.includes('wntoken')) {
            req.abort(); // Bỏ qua token request để tăng tốc
        } else {
            req.continue();
        }
    });
    
    return { browser, page };
}

async function scrapeHTML(page, pageNum) {
    const url = pageNum === 1 ? SEARCH_BASE_URL : `${SEARCH_BASE_URL}&page=${pageNum}`;
    console.error(` -> Đang cào dữ liệu từ trang ${url}...`);
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Chờ explicit cho phần job load (dựa trên tiêu đề trang)
        await page.waitForSelector('body', { timeout: 10000 });
        
        // Cuộn trang 3 lần để tải lazy content
        for (let i = 0; i < 3; i++) {
            await page.evaluate(async () => {
                window.scrollBy(0, window.innerHeight);
                await new Promise(resolve => setTimeout(resolve, 1000));
            });
        }
        
        // Chờ phần job listings (thử nhiều selector)
        try {
            await page.waitForSelector('.job-item, .job__list--item, .list-jobs .item, [class*="job"]', { timeout: 5000 });
        } catch (e) {
            console.error(` -> Không tìm thấy selector job, thử chờ thêm...`);
        }
        
        // Chụp ảnh màn hình để debug
        await page.screenshot({ path: `debug_screenshot_page_${pageNum}.png`, fullPage: true });
        
        // Ghi HTML đầy đủ để debug
        const htmlContent = await page.content();
        fs.writeFileSync(`debug_html_page_${pageNum}.html`, htmlContent);
        console.error(` -> Đã lưu debug HTML cho trang ${pageNum} (kích thước: ${htmlContent.length} ký tự)`);

        const jobs = await page.evaluate((keyword) => {
            // Selector tinh chỉnh dựa trên cấu trúc CareerViet (từ phân tích chung)
            const jobElements = document.querySelectorAll('.job-item, .job__list--item, .list-jobs .item, div[class*="job"], .search-result-item');
            console.log(` -> Tìm thấy ${jobElements.length} phần tử job tiềm năng`); // Log trong evaluate để debug
            
            return Array.from(jobElements).map((el, index) => {
                // Selector cho từng trường (nhiều lựa chọn)
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
                
                const jobId = link.match(/\.([0-9A-F]{8})\.html$/)?.[1] || `job_${index}`;
                
                return { title, company, location, salary, activeDate, expiryDate, link, jobId };
            }).filter(job => job.title.toLowerCase().includes(keyword.toLowerCase()) && job.title !== 'N/A');
        }, TARGET_KEYWORD);

        console.error(` -> Trích xuất được ${jobs.length} job từ trang ${pageNum}`);
        return jobs;
    } catch (error) {
        console.error(` -> Lỗi khi cào HTML trang ${pageNum}: ${error.message}`);
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
    try {
        ({ browser, page } = await getBrowserContext());

        console.error(`--- Bắt đầu khai thác dữ liệu CareerViet cho từ khóa: "${TARGET_KEYWORD}" ---`);

        // Thử API ngắn gọn (1 trang)
        try {
            await page.goto(SEARCH_BASE_URL, { waitUntil: 'networkidle2' });
            const cookies = await page.cookies();
            const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            const response = await axios.post(API_JOB_SEARCH, {
                keyword: TARGET_KEYWORD,
                page: 1,
                size: JOBS_PER_PAGE
            }, {
                headers: {
                    'User-Agent': FAKE_USER_AGENTS[0],
                    'Content-Type': 'application/json',
                    'Cookie': cookieHeader,
                    'Accept': 'application/json',
                    'Referer': SEARCH_BASE_URL,
                    'Origin': 'https://careerviet.vn'
                }
            });

            const jobs = response.data?.data;
            if (jobs && Array.isArray(jobs) && jobs.length > 0) {
                console.error(` -> API thành công! Tìm thấy ${jobs.length} job.`);
                // Xử lý jobs từ API như trước (map và filter)
                const newJobs = jobs.filter(job => job.JOB_TITLE?.toLowerCase().includes(TARGET_KEYWORD.toLowerCase()))
                    .map(job => ({
                        'Tên công việc': job.JOB_TITLE || 'N/A',
                        'Tên công ty': job.EMP_NAME || 'N/A',
                        'Nơi làm việc': job.LOCATION_NAME_ARR?.join(', ') || 'N/A',
                        'Mức lương': job.JOB_SALARY_STRING || 'N/A',
                        'Ngày đăng tin': job.JOB_ACTIVEDATE || 'N/A',
                        'Ngày hết hạn': job.JOB_LASTDATE || 'N/A',
                        'Link': job.LINK_JOB || 'N/A'
                    }));
                allJobs = [...allJobs, ...newJobs];
            } else {
                console.error(` -> API thất bại, chuyển sang cào HTML.`);
            }
        } catch (apiError) {
            console.error(` -> Lỗi API: ${apiError.message}. Chuyển sang cào HTML.`);
        }

        // Cào HTML nếu cần
        if (allJobs.length === 0) {
            while (pageNum <= MAX_PAGES) {
                const jobs = await scrapeHTML(page, pageNum);
                if (jobs.length === 0) {
                    console.error(` -> Không còn dữ liệu ở trang ${pageNum}. Kết thúc.`);
                    break;
                }

                const newJobs = jobs.filter(job => !jobIds.has(job.jobId)).map(job => {
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
                pageNum++;
                
                // Kiểm tra pagination tự động (nếu không có job mới)
                if (newJobs.length < 5) break; // Dừng sớm nếu ít job
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
