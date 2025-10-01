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
const SEARCH_PAGE = "https://careerviet.vn/viec-lam/tat-ca-viec-lam-trang-1-vi.html";

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
        executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' // Sử dụng Chrome từ action
    });
    const page = await browser.newPage();
    
    // Ngẫu nhiên User-Agent
    const userAgent = FAKE_USER_AGENTS[Math.floor(Math.random() * FAKE_USER_AGENTS.length)];
    await page.setUserAgent(userAgent);
    
    // Truy cập trang tìm kiếm để lấy cookie và csrf_token
    await page.goto(SEARCH_PAGE, { waitUntil: 'networkidle2' });
    
    const cookies = await page.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    
    // Trích xuất csrf_token nếu có
    let csrfToken = '';
    try {
        csrfToken = await page.evaluate(() => document.querySelector('input[name="csrf_token"]')?.value || '');
    } catch (e) {
        console.error(' -> Không tìm thấy csrf_token trên trang');
    }
    
    return { browser, page, cookieHeader, csrfToken };
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
        ({ browser, page, cookieHeader, csrfToken } = await getBrowserContext());
    } catch (e) {
        console.error(`Lỗi khi khởi tạo trình duyệt: ${e.message}`);
        return;
    }

    try {
        console.error(`--- Bắt đầu khai thác dữ liệu CareerViet cho từ khóa: "${TARGET_KEYWORD}" ---`);

        while (pageNum <= MAX_PAGES) {
            console.error(` -> Đang lấy dữ liệu trang ${pageNum}...`);
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
                console.error(` -> Không còn dữ liệu ở trang ${pageNum}. Kết thúc phân trang.`);
                break;
            }

            console.error(` -> Phân tích thành công trang ${pageNum}! Tìm thấy ${jobs.length} tin tuyển dụng.`);

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
        await page.screenshot({ path: 'error_screenshot_careerviet.png' });
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
