// --- BẦY SÓI BỀN BỈ (SCRAPER) ---
// Cập nhật: Có khả năng tự làm mới proxy ngay giữa nhiệm vụ.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const { buildUrl } = require('./url_builder');
const { getNewProxy } = require('./proxy_handler'); // <-- Nhập khẩu "Bộ đàm"

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const BROWSER_TIMEOUT = 90000;
const PAGE_LOAD_TIMEOUT = 60000;
const PAGES_PER_PROXY = 5; // <-- SỐ TRANG TỐI ĐA TRƯỚC KHI "BIẾN HÌNH"

// --- HÀM TIỆN ÍCH ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.random() * (max - min) + min;

// --- HÀM THU THẬP DỮ LIỆU CHÍNH ---
async function scrapeInChunks(keyword, startPage, endPage, workerId, apiKey, apiEndpoint) {
    console.error(`--- [Sói ${workerId}] Bắt đầu nhiệm vụ: Săn mồi từ trang ${startPage} đến ${endPage} ---`);
    let browser;
    const allJobsForWorker = [];

    try {
        // Vòng lặp chính, đi qua từng trang được giao
        for (let currentPage = startPage; currentPage <= endPage; currentPage++) {
            
            // --- LOGIC "BIẾN HÌNH" ---
            // Kiểm tra xem có cần làm mới danh tính không
            if ((currentPage - startPage) % PAGES_PER_PROXY === 0) {
                if (browser) {
                    await browser.close(); // Đóng phiên làm việc cũ
                    console.error(`\n   -> [Sói ${workerId}] Đã đóng phiên làm việc cũ.`);
                }
                console.error(`   -> [Sói ${workerId}] Đã đến lúc "biến hình". Yêu cầu danh tính mới...`);
                
                const proxy = await getNewProxy(apiKey, apiEndpoint);
                if (!proxy) {
                    throw new Error("Không thể lấy proxy mới, nhiệm vụ thất bại.");
                }

                const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', `--proxy-server=${proxy.host}:${proxy.port}`];
                browser = await puppeteer.launch({ headless: true, args: browserArgs, ignoreHTTPSErrors: true, timeout: BROWSER_TIMEOUT });
            }

            const page = await browser.newPage();
            await page.setViewport({ width: 1920, height: 1080 });

            const targetUrl = buildUrl(keyword, currentPage);
            console.error(`   -> [Sói ${workerId}] Đang tiếp cận mục tiêu: Trang ${currentPage}...`);

            try {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
                
                const jobListSelector = 'div.job-list-search-result';
                await page.waitForSelector(jobListSelector, { timeout: 30000 });
                
                let previousHtml = '', currentHtml = '', stabilityCounter = 0;
                for (let check = 0; check < 10; check++) {
                    currentHtml = await page.$eval(jobListSelector, element => element.innerHTML);
                    if (currentHtml.replace(/\s/g, '') === previousHtml.replace(/\s/g, '') && currentHtml.length > 0) {
                        if (++stabilityCounter >= 2) break;
                    } else { stabilityCounter = 0; }
                    previousHtml = currentHtml;
                    await sleep(2000);
                }
                if (stabilityCounter < 2) throw new Error("Trang không ổn định.");

                const content = await page.content();
                const $ = cheerio.load(content);
                const jobListings = $('div[class*="job-item"]');
                const jobsOnPage = [];

                if (jobListings.length === 0) {
                    console.error(`   -> Không tìm thấy tin tuyển dụng nào trên trang ${currentPage}.`);
                    continue; // Bỏ qua trang này và tiếp tục với trang tiếp theo
                }
                
                jobListings.each((index, element) => {
                    const titleTag = $(element).find('h3[class*="title"] a');
                    const companyLogoTag = $(element).find('img.w-100.lazy');
                    const salaryTag = $(element).find('.title-salary');
                    const locationTag = $(element).find('.city-text');
                    const dateContainerTag = $(element).find('span.hidden-on-quick-view');
                    const expTag = $(element).find('.exp');
                    
                    let companyText = companyLogoTag.length ? (companyLogoTag.attr('alt') || '').trim() : null;
                    let dateText = null;
                    if (dateContainerTag.length) {
                        const nextNode = dateContainerTag[0].nextSibling;
                        if (nextNode && nextNode.type === 'text') dateText = nextNode.data.trim();
                    }
                    
                    jobsOnPage.push({
                        'keyword': keyword,
                        'title': titleTag.text().trim() || null,
                        'link': titleTag.attr('href') ? `https://www.topcv.vn${titleTag.attr('href')}` : null,
                        'company': companyText,
                        'salary': salaryTag.text().trim() || 'Thỏa thuận',
                        'Nơi làm việc': locationTag.text().trim() || null,
                        'thời gian đăng': dateText,
                        'Kinh nghiệm làm việc tối thiểu': (expTag.text() || '').trim() || null,
                    });
                });

                allJobsForWorker.push(...jobsOnPage);
                console.error(`   -> [Sói ${workerId}] Đã thu thập ${jobsOnPage.length} tin từ trang ${currentPage}.`);
                
            } catch (error) {
                console.error(`   -> [Sói ${workerId}] Gặp lỗi tại trang ${currentPage}: ${error.message}. Sẽ thử lại với danh tính mới ở lần "biến hình" tiếp theo.`);
            } finally {
                if(page) await page.close(); // Đóng tab sau mỗi lần truy cập
            }
        }
        return allJobsForWorker;

    } catch (error) {
        console.error(`[Sói ${workerId}] Nhiệm vụ thất bại không thể phục hồi: ${error.message}`);
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

// --- HÀM MAIN ĐỂ CHẠY TỪ DÒNG LỆNH ---
(async () => {
    const args = process.argv.slice(2);
    if (args.length !== 4) {
        console.error("Cách dùng: node scraper.js [keyword] [startPage] [endPage] [workerId]");
        process.exit(1);
    }
    const [keyword, startPageStr, endPageStr, workerId] = args;
    const startPage = parseInt(startPageStr, 10);
    const endPage = parseInt(endPageStr, 10);
    const apiKey = process.env.PROXY_API_KEY;
    const apiEndpoint = process.env.PROXY_API_ENDPOINT;

    const results = await scrapeInChunks(keyword, startPage, endPage, workerId, apiKey, apiEndpoint);

    if (results.length > 0) {
        const outputFilename = `results_worker_${workerId}.csv`;
        const csvData = stringify(results, { header: true });
        fs.writeFileSync(outputFilename, '\ufeff' + csvData);
        console.error(`[Sói ${workerId}] Đã lưu ${results.length} tin vào ${outputFilename}`);
    } else {
        console.error(`[Sói ${workerId}] Không thu thập được dữ liệu nào.`);
    }
})();

