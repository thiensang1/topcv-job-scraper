<<<<<<< HEAD:collector.js
// --- ĐẶC NHIỆM CHỚP NHOÁNG (COLLECTOR) - PHIÊN BẢN "TỰ CHỦ" ---
// Cập nhật: Chỉ thu thập một trang duy nhất và tin tưởng vào cơ chế tìm kiếm trình duyệt mặc định.
=======
// --- BẦY SÓI BỀN BỈ (SCRAPER) ---
// Cập nhật: Có khả năng tự làm mới proxy ngay giữa nhiệm vụ.
>>>>>>> 27edadc (feat!: Refactor architecture to Persistent Wolf Pack pattern):scraper.js

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const { buildUrl } = require('./url_builder');
<<<<<<< HEAD:collector.js
=======
const { getNewProxy } = require('./proxy_handler'); // <-- Nhập khẩu "Bộ đàm"
>>>>>>> 27edadc (feat!: Refactor architecture to Persistent Wolf Pack pattern):scraper.js

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const BROWSER_TIMEOUT = 90000;
const PAGE_LOAD_TIMEOUT = 60000;
const PAGES_PER_PROXY = 5; // <-- SỐ TRANG TỐI ĐA TRƯỚC KHI "BIẾN HÌNH"

// --- HÀM TIỆN ÍCH ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- HÀM THU THẬP DỮ LIỆU CHÍNH ---
<<<<<<< HEAD:collector.js
async function scrapeSinglePage(keyword, pageNum, proxy) {
    console.error(`--- [Đặc nhiệm ${pageNum}] Bắt đầu nhiệm vụ chớp nhoáng: Thu thập '${keyword}', trang ${pageNum} ---`);
    
    let browser;
    
    if (!proxy || !proxy.host || !proxy.port) {
        console.error(`   -> [Đặc nhiệm ${pageNum}] Lỗi nghiêm trọng: Không nhận được thông tin proxy. Dừng lại.`);
        return [];
    }

    const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--proxy-server=${proxy.host}:${proxy.port}`,
    ];

    try {
        // KIẾN TRÚC "TỰ CHỦ": Tin tưởng Puppeteer tự tìm trình duyệt
        browser = await puppeteer.launch({
            headless: true,
            args: browserArgs,
            ignoreHTTPSErrors: true,
            timeout: BROWSER_TIMEOUT
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const targetUrl = buildUrl(keyword, pageNum);
        console.error(`   -> [Đặc nhiệm ${pageNum}] Đang tiếp cận mục tiêu: Trang ${pageNum}...`);

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });

        const jobListSelector = 'div.job-list-search-result';
        await page.waitForSelector(jobListSelector, { timeout: 30000 });
        
        // Giai đoạn "quan sát kiên nhẫn"
        let previousHtml = '', currentHtml = '', stabilityCounter = 0;
        for (let check = 0; check < 10; check++) {
            currentHtml = await page.$eval(jobListSelector, element => element.innerHTML);
            if (currentHtml.replace(/\s/g, '') === previousHtml.replace(/\s/g, '') && currentHtml.length > 0) {
                if (++stabilityCounter >= 2) break;
            } else { stabilityCounter = 0; }
            previousHtml = currentHtml;
            await sleep(2000);
=======
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

                if (jobListings.length === 0) {
                    console.error(`   -> Không tìm thấy tin tuyển dụng nào trên trang ${currentPage}.`);
                    continue; // Bỏ qua trang này và tiếp tục với trang tiếp theo
                }
                
                const jobsOnPage = [];
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
                if (page) await page.close(); // Đóng tab sau mỗi lần truy cập
            }
>>>>>>> 27edadc (feat!: Refactor architecture to Persistent Wolf Pack pattern):scraper.js
        }
        if (stabilityCounter < 2) throw new Error("Trang không ổn định.");
        
        const content = await page.content();
        const $ = cheerio.load(content);
        const jobListings = $('div[class*="job-item"]');

        if (jobListings.length === 0) {
            console.error(`   -> [Đặc nhiệm ${pageNum}] Không tìm thấy tin tuyển dụng nào trên trang ${pageNum}.`);
            return [];
        }
         
        const jobsOnPage = [];
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

        console.error(`   -> [Đặc nhiệm ${pageNum}] Đã thu thập ${jobsOnPage.length} tin từ trang ${pageNum}. Rút lui.`);
        return jobsOnPage;

    } catch (error) {
<<<<<<< HEAD:collector.js
        console.error(`   -> [Đặc nhiệm ${pageNum}] Nhiệm vụ thất bại tại trang ${pageNum}: ${error.message}`);
=======
        console.error(`[Sói ${workerId}] Nhiệm vụ thất bại không thể phục hồi: ${error.message}`);
>>>>>>> 27edadc (feat!: Refactor architecture to Persistent Wolf Pack pattern):scraper.js
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

// --- HÀM MAIN ĐỂ CHẠY TỪ DÒNG LỆNH ---
(async () => {
    // Cập nhật: Chỉ nhận vào 1 trang duy nhất, và không cần chromePath
    const args = process.argv.slice(2);
    if (args.length !== 4) {
<<<<<<< HEAD:collector.js
        console.error("Cách dùng: node collector.js [keyword] [pageNum] [proxyHost] [proxyPort]");
        process.exit(1);
    }
    const [keyword, pageNumStr, proxyHost, proxyPort] = args;
    const pageNum = parseInt(pageNumStr, 10);
    const proxy = { host: proxyHost, port: proxyPort };

    const results = await scrapeSinglePage(keyword, pageNum, proxy);
=======
        console.error("Cách dùng: node scraper.js [keyword] [startPage] [endPage] [workerId]");
        process.exit(1);
    }
    const [keyword, startPageStr, endPageStr, workerId] = args;
    const startPage = parseInt(startPageStr, 10);
    const endPage = parseInt(endPageStr, 10);
    const apiKey = process.env.PROXY_API_KEY;
    const apiEndpoint = process.env.PROXY_API_ENDPOINT;

    const results = await scrapeInChunks(keyword, startPage, endPage, workerId, apiKey, apiEndpoint);
>>>>>>> 27edadc (feat!: Refactor architecture to Persistent Wolf Pack pattern):scraper.js

    if (results.length > 0) {
        // Tên file giờ đây được đặt theo số trang để tránh trùng lặp
        const outputFilename = `results_page_${pageNum}.csv`;
        const csvData = stringify(results, { header: true });
        fs.writeFileSync(outputFilename, '\ufeff' + csvData);
<<<<<<< HEAD:collector.js
        console.error(`[Đặc nhiệm ${pageNum}] Đã lưu ${results.length} tin vào ${outputFilename}`);
    } else {
        console.error(`[Đặc nhiệm ${pageNum}] Không thu thập được dữ liệu nào.`);
=======
        console.error(`[Sói ${workerId}] Đã lưu ${results.length} tin vào ${outputFilename}`);
    } else {
        console.error(`[Sói ${workerId}] Không thu thập được dữ liệu nào.`);
>>>>>>> 27edadc (feat!: Refactor architecture to Persistent Wolf Pack pattern):scraper.js
    }
})();

