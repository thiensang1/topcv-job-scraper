const fs = require('fs');
const puppeteer = require('puppeteer');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const MAX_PAGES = 537; // Giới hạn dựa trên trang cuối cùng
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

async function getBrowserContext() {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
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
    const startTime = Date.now();
    const url = `${SEARCH_BASE_URL}-${pageNum}-vi.html`;
    console.error(` -> Bắt đầu trang ${pageNum}: ${url}`);
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // Giữ 60s như cũ
        
        // Chờ job list
        try {
            await page.waitForSelector('.job-item, .job__list--item, .list-jobs .item, [class*="job"], .search-result-item, .matching-scores', { timeout: 10000 });
        } catch (e) {
            console.error(` -> Không tìm thấy job list ở trang ${pageNum}, chờ thêm...`);
            await new Promise(resolve => setTimeout(resolve, 3000)); // Giảm chờ
        }
        
        // Cuộn trang 2 lần (giảm để tăng tốc)
        for (let i = 0; i < 2; i++) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Clear cache mỗi 10 trang để tối ưu bộ nhớ (thay restart browser)
        if (pageNum % 10 === 0) {
            await page.evaluate(() => window.localStorage.clear());
            console.error(` -> Đã clear cache tại trang ${pageNum}`);
        }
        
        // Debug (chỉ cho trang quan trọng)
        if (pageNum === 1 || pageNum === 2 || pageNum === 62 || pageNum % 50 === 0) {
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

        const endTime = Date.now();
        console.error(` -> Kết thúc trang ${pageNum}: ${jobs.length} job (${(endTime - startTime)/1000}s)`);
        
        // Kiểm tra nút "Next" (không dùng để break, chỉ log)
        const hasNextPage = await page.evaluate(() => {
            const nextButton = document.querySelector('a.next, a.pagination-next, [rel="next"], .next-page');
            return !!nextButton && !nextButton.classList.contains('disabled');
        });
        console.error(` -> Trang ${pageNum} có trang tiếp: ${hasNextPage}`);
        
        return { jobs, hasNextPage };
    } catch (error) {
        console.error(` -> Lỗi trang ${pageNum}: ${error.message}`);
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

    try {
        ({ browser, page } = await getBrowserContext());
        console.error(`--- Bắt đầu khai thác dữ liệu CareerViet cho từ khóa: "${TARGET_KEYWORD}" (tối đa ${MAX_PAGES} trang) ---`);

        while (pageNum <= MAX_PAGES) {
            const { jobs } = await scrapeHTML(page, pageNum);
            
            // Dừng nếu không có job (không kiểm tra hasNextPage nghiêm ngặt)
            if (jobs.length === 0) {
                console.error(` -> Không có job ở trang ${pageNum}. Kết thúc.`);
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
            pageNum++;
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
