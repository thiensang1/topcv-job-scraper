// --- CÔNG NHÂN KHAI THÁC - PHIÊN BẢN "THỐNG NHẤT" ---
// Cập nhật: Sử dụng "Nguồn Chân lý Duy nhất" (url_builder.js) để tạo URL.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const { buildUrl } = require('./url_builder'); // <-- NHẬP KHẨU "SÁCH HƯỚNG DẪN"

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const BROWSER_TIMEOUT = 90000;
const PAGE_LOAD_TIMEOUT = 60000;

// --- HÀM TIỆN ÍCH ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.random() * (max - min) + min;

// --- HÀM THU THẬP DỮ LIỆU CHÍNH ---
async function scrapeTopCV(keyword, startPage, endPage, workerId, proxy, chromePath) {
    // Chuyển toàn bộ nhật ký sang stderr
    console.error(`--- [Worker ${workerId}] Bắt đầu nhiệm vụ: Thu thập '${keyword}' từ trang ${startPage} đến ${endPage} ---`);
    
    let browser, page;
    
    if (!proxy || !proxy.host || !proxy.port) {
        console.error(`   -> [Worker ${workerId}] Lỗi nghiêm trọng: Không nhận được thông tin proxy. Dừng lại.`);
        return [];
    }
    if (!chromePath) {
        console.error(`   -> [Worker ${workerId}] Lỗi nghiêm trọng: Không nhận được 'Bản đồ Dẫn đường'. Dừng lại.`);
        return [];
    }

    const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--proxy-server=${proxy.host}:${proxy.port}`,
    ];

    try {
        console.error(`   -> [Worker ${workerId}] Sử dụng "chiếc xe" tại: ${chromePath}`);
        browser = await puppeteer.launch({
            headless: true,
            executablePath: chromePath,
            args: browserArgs,
            ignoreHTTPSErrors: true,
            timeout: BROWSER_TIMEOUT
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        let allJobsForWorker = [];

        for (let i = startPage; i <= endPage; i++) {
            // Sử dụng "Sách hướng dẫn" để tạo URL
            const targetUrl = buildUrl(keyword, i);
            console.error(`   -> [Worker ${workerId}] Đang truy cập trang ${i} với danh tính ${proxy.host}...`);

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
                
                await page.evaluate(() => { window.scrollBy(0, document.body.scrollHeight); });
                await sleep(randomDelay(1000, 2000));

                const content = await page.content();
                const $ = cheerio.load(content);
                const jobListings = $('div[class*="job-item"]');

                if (jobListings.length === 0) {
                    console.error(`   -> [Worker ${workerId}] Không tìm thấy tin tuyển dụng nào trên trang ${i}, kết thúc sớm.`);
                    break;
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
                    
                    allJobsForWorker.push({
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

                console.error(`   -> [Worker ${workerId}] Đã thu thập ${jobListings.length} tin từ trang ${i}.`);

                const lastPaginationItem = $('ul.pagination li:last-child');
                if (lastPaginationItem.hasClass('disabled')) {
                    console.error(`   -> [Worker ${workerId}] Đã đến trang cuối cùng. Dừng lại.`);
                    break;
                }
                
                await sleep(randomDelay(3000, 5000));

            } catch (error) {
                console.error(`   -> [Worker ${workerId}] Lỗi khi xử lý trang ${i}: ${error.message}`);
                break; 
            }
        }
        return allJobsForWorker;

    } catch (error) {
        console.error(`   -> [Worker ${workerId}] Lỗi nghiêm trọng không thể phục hồi: ${error.message}`);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// --- HÀM MAIN ĐỂ CHẠY TỪ DÒNG LỆNH ---
(async () => {
    const args = process.argv.slice(2);
    if (args.length !== 7) {
        console.error("Cách dùng: node collector.js [keyword] [startPage] [endPage] [workerId] [proxyHost] [proxyPort] [chromePath]");
        process.exit(1);
    }
    const [keyword, startPageStr, endPageStr, workerId, proxyHost, proxyPort, chromePath] = args;
    const startPage = parseInt(startPageStr, 10);
    const endPage = parseInt(endPageStr, 10);
    const proxy = { host: proxyHost, port: proxyPort };

    const results = await scrapeTopCV(keyword, startPage, endPage, workerId, proxy, chromePath);

    if (results.length > 0) {
        const outputFilename = `results_worker_${workerId}.csv`;
        const csvData = stringify(results, { header: true });
        fs.writeFileSync(outputFilename, '\ufeff' + csvData);
        console.error(`[Worker ${workerId}] Đã lưu ${results.length} tin vào ${outputFilename}`);
    } else {
        console.error(`[Worker ${workerId}] Không thu thập được dữ liệu nào.`);
    }
})();

