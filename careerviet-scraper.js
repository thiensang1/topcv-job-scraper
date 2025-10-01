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
const SEARCH_PAGE = `https://careerviet.vn/viec-lam/tim-kiem?key=${encodeURIComponent(TARGET_KEYWORD)}`;

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
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome'
    });
    const page = await browser.newPage();
    
    // Ngẫu nhiên User-Agent
    const userAgent = FAKE_USER_AGENTS[Math.floor(Math.random() * FAKE_USER_AGENTS.length)];
    await page.setUserAgent(userAgent);
    
    return { browser, page };
}

async function scrapeHTML(page, pageNum) {
    const url = `${SEARCH_PAGE}&page=${pageNum}`;
    console.error(` -> Đang cào dữ liệu từ trang ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    const jobs = await page.evaluate(() => {
        const jobElements = document.querySelectorAll('.job-item'); // Điều chỉnh selector nếu cần
        return Array.from(jobElements).map(el => {
            const title = el.querySelector('.job-title, .job__list--title a')?.textContent.trim() || 'N/A';
            const company = el.querySelector('.company-name, .job__list--company')?.textContent.trim() || 'N/A';
            const location = el.querySelector('.location, .job__list--location')?.textContent.trim() || 'N/A';
            const salary = el.querySelector('.salary, .job__list--salary')?.textContent.trim() || 'N/A';
            const activeDate = el.querySelector('.date-posted, .job__list--date')?.textContent.trim() || 'N/A';
            const expiryDate = el.querySelector('.date-expiry, .job__list--expiry')?.textContent.trim() || 'N/A';
            const link = el.querySelector('a')?.href || 'N/A';
            const jobId = el.querySelector('a')?.href.match(/\.([0-9A-F]+)\.html$/)?.[1] || link; // Lấy JOB_ID từ URL
            return { title, company, location, salary, activeDate, expiryDate, link, jobId };
        });
    });

    return jobs.filter(job => job.title.toLowerCase().includes('kế toán')); // Lọc theo từ khóa
}

// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    let allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";
    let pageNum = 1;
    const jobIds = new Set();

    let browser, page, cookieHeader, csrfToken;
    try {
        ({ browser, page } = await getBrowserContext());

        // Thử gọi API trước
        console.error(`--- Bắt đầu khai thác dữ liệu CareerViet cho từ khóa: "${TARGET_KEYWORD}" ---`);
        
        // Lấy cookie và csrf_token
        await page.goto(SEARCH_PAGE, { waitUntil: 'networkidle2' });
        const cookies = await page.cookies();
        cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        try {
            csrfToken = await page.evaluate(() => document.querySelector('input[name="csrf_token"]')?.value || '');
        } catch (e) {
            console.error(' -> Không tìm thấy csrf_token trên trang');
        }

        // Thử API
        try {
            while (pageNum <= MAX_PAGES) {
                console.error(` -> Đang lấy dữ liệu API trang ${pageNum}...`);
                const response = await axios.post(
                    API_JOB_SEARCH,
                    {
                        keyword: TARGET_KEYWORD,
                        page: pageNum,
                        size: JOBS_PER_PAGE
                    },
                    {
                        headers: {
                            'User-Agent': FAKE_USER_AGENTS[Math.floor(Math.random() * FAKE_USER_AGENTS.length)],
                            'Content-Type': 'application/json',
                            'Cookie': cookieHeader,
                            'X-CSRF-Token': csrfToken || undefined,
                            'Accept': 'application/json',
                            'Referer': SEARCH_PAGE,
                            'Origin': 'https://careerviet.vn'
                        },
                        proxy: process.env.PROXY_URL ? {
                            host: new URL(process.env.PROXY_URL).hostname,
                            port: new URL(process.env.PROXY_URL).port || 80,
                            protocol: new URL(process.env.PROXY_URL).protocol.replace(':', '')
                        } : false
                    }
                );

                const jobs = response.data?.data;

                if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
                    console.error(` -> API không trả về dữ liệu ở trang ${pageNum}. Chuyển sang cào HTML...`);
                    break;
                }

                console.error(` -> Phân tích thành công API trang ${pageNum}! Tìm thấy ${jobs.length} tin tuyển dụng.`);

                const newJobs = jobs
                    .filter(job => {
                        const isRelevant = job.JOB_TITLE?.toLowerCase().includes(TARGET_KEYWORD.toLowerCase());
                        if (!isRelevant || jobIds.has(job.JOB_ID)) return false;
                        jobIds.add(job.JOB_ID);
                        return true;
                    })
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
                pageNum++;
            }
        } catch (apiError) {
            console.error(` -> Lỗi khi gọi API: ${apiError.message}. Chuyển sang cào HTML...`);
        }

        // Nếu API thất bại hoặc không có dữ liệu, cào HTML
        if (allJobs.length === 0) {
            pageNum = 1;
            while (pageNum <= MAX_PAGES) {
                const jobs = await scrapeHTML(page, pageNum);
                if (jobs.length === 0) {
                    console.error(` -> Không còn dữ liệu HTML ở trang ${pageNum}. Kết thúc phân trang.`);
                    break;
                }

                console.error(` -> Phân tích thành công HTML trang ${pageNum}! Tìm thấy ${jobs.length} tin tuyển dụng.`);

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
                pageNum++;
            }
        }

    } catch (error) {
        let errorMessage = error.message;
        if (error.response) {
            errorMessage = `Request failed with status code ${error.response.status}: ${JSON.stringify(error.response.data)}`;
            console.error(` -> Headers: ${JSON.stringify(error.response.headers)}`);
        } else if (error.request) {
            errorMessage = 'No response received from server';
        }
        console.error(`Lỗi nghiêm trọng trong chiến dịch: ${errorMessage}`);
        
        // Chụp ảnh màn hình lỗi
        if (page) await page.screenshot({ path: 'error_screenshot_careerviet.png' });
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
