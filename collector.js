// --- CÔNG NHÂN KHAI THÁC - PHIÊN BẢN "ĐẶC NHIỆM THÍCH ỨNG" ---
// Nâng cấp: Tự động xoay vòng Proxy ngay giữa nhiệm vụ

// Import các thư viện cần thiết
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const BASE_URL = "https://www.topcv.vn";
const BROWSER_TIMEOUT = 90000;
const PAGE_LOAD_TIMEOUT = 60000;
// Thời gian làm mới proxy (2.5 phút = 150000 ms), an toàn hơn so với 3 phút
const PROXY_REFRESH_INTERVAL_MS = 150000; 

// --- HÀM TIỆN ÍCH ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.random() * (max - min) + min;

// --- HÀM LẤY PROXY MỚI TỪ API ---
async function getNewProxy(apiKey, apiEndpoint) {
    if (!apiKey || !apiEndpoint) {
        console.log("   -> Cảnh báo: Không có thông tin API Proxy. Chạy không cần proxy.");
        return null;
    }
    try {
        console.log("   -> Đang yêu cầu một danh tính proxy MỚI từ API...");
        const response = await axios.get(apiEndpoint, {
            params: { key: apiKey, region: 'random' },
            timeout: 15000
        });

        if (response.data?.data?.proxy) {
            const proxyData = response.data.data.proxy.split(':');
            if (proxyData.length === 4) {
                const [host, port, user, pass] = proxyData;
                console.log(`   -> Đã nhận proxy mới thành công: ${host}:${port}`);
                return { host, port, user, pass };
            }
        }
        throw new Error("Phản hồi từ API proxy không hợp lệ.");
    } catch (error) {
        console.error(`   -> Lỗi nghiêm trọng khi yêu cầu proxy mới: ${error.message}`);
        return null;
    }
}

// --- HÀM KHỞI TẠO TRÌNH DUYỆT MỚI VỚI PROXY ---
async function launchBrowserWithProxy(proxy) {
    const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--proxy-server=${proxy.host}:${proxy.port}`,
    ];
    const browser = await puppeteer.launch({
        headless: true,
        args: browserArgs,
        ignoreHTTPSErrors: true,
        timeout: BROWSER_TIMEOUT
    });
    const page = await browser.newPage();
    await page.authenticate({ username: proxy.user, password: proxy.pass });
    await page.setViewport({ width: 1920, height: 1080 });
    return { browser, page };
}


// --- HÀM THU THẬP DỮ LIỆU CHÍNH ---
async function scrapeTopCV(keyword, startPage, endPage, workerId) {
    console.log(`--- [Worker ${workerId}] Bắt đầu nhiệm vụ: Thu thập '${keyword}' từ trang ${startPage} đến ${endPage} ---`);
    
    const PROXY_API_KEY = process.env.PROXY_API_KEY;
    const PROXY_API_ENDPOINT = process.env.PROXY_API_ENDPOINT;

    let browser, page;
    let currentProxy = null;
    let lastProxyRefreshTime = 0;
    let allJobsForWorker = [];

    try {
        for (let i = startPage; i <= endPage; i++) {
            // --- LOGIC "BIẾN HÌNH" ---
            const timeSinceLastRefresh = Date.now() - lastProxyRefreshTime;
            if (!currentProxy || timeSinceLastRefresh > PROXY_REFRESH_INTERVAL_MS) {
                console.log(`   -> [Worker ${workerId}] Danh tính cũ đã hết hạn hoặc chưa có. Bắt đầu "biến hình"...`);
                if (browser) await browser.close(); // Đóng trình duyệt cũ nếu có
                
                currentProxy = await getNewProxy(PROXY_API_KEY, PROXY_API_ENDPOINT);
                if (!currentProxy) {
                    console.log(`   -> [Worker ${workerId}] Không thể "biến hình". Dừng nhiệm vụ.`);
                    break;
                }
                lastProxyRefreshTime = Date.now();
                
                const browserSession = await launchBrowserWithProxy(currentProxy);
                browser = browserSession.browser;
                page = browserSession.page;
            }

            const targetUrl = `${BASE_URL}/tim-viec-lam-${keyword}-cr392cb393?type_keyword=1&page=${i}&category_family=r392~b393`;
            console.log(`   -> [Worker ${workerId}] Đang truy cập trang ${i} với danh tính ${currentProxy.host}...`);

            try {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });

                const jobListSelector = 'div.job-list-search-result';
                await page.waitForSelector(jobListSelector, { timeout: 30000 });

                // Giai đoạn "quan sát kiên nhẫn" để chờ trang ổn định
                let previousHtml = '', currentHtml = '', stabilityCounter = 0;
                for (let check = 0; check < 10; check++) {
                    currentHtml = await page.$eval(jobListSelector, element => element.innerHTML);
                    if (currentHtml.replace(/\s/g, '') === previousHtml.replace(/\s/g, '') && currentHtml.length > 0) {
                        if (++stabilityCounter >= 2) break;
                    } else {
                        stabilityCounter = 0;
                    }
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
                    console.log(`   -> [Worker ${workerId}] Không tìm thấy tin tuyển dụng nào trên trang ${i}, kết thúc sớm.`);
                    break;
                }

                 jobListings.each((index, element) => {
                    // Logic trích xuất chi tiết... (giữ nguyên như cũ)
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
                        'link': titleTag.attr('href') ? `${BASE_URL}${titleTag.attr('href')}` : null,
                        'company': companyText,
                        'salary': salaryTag.text().trim() || 'Thỏa thuận',
                        'Nơi làm việc': locationTag.text().trim() || null,
                        'thời gian đăng': dateText,
                        'Kinh nghiệm làm việc tối thiểu': (expTag.text() || '').trim() || null,
                    });
                });

                console.log(`   -> [Worker ${workerId}] Đã thu thập ${jobListings.length} tin từ trang ${i}.`);

                const lastPaginationItem = $('ul.pagination li:last-child');
                if (lastPaginationItem.hasClass('disabled')) {
                    console.log(`   -> [Worker ${workerId}] Đã đến trang cuối cùng. Dừng lại.`);
                    break;
                }
                
                await sleep(randomDelay(3000, 5000));

            } catch (error) {
                console.error(`   -> [Worker ${workerId}] Lỗi khi xử lý trang ${i}: ${error.message}`);
                // Khi gặp lỗi trang, coi như đã đến trang cuối để chuyển sang worker khác
                break; 
            }
        }
        return allJobsForWorker;

    } catch (error) {
        console.error(`   -> [Worker ${workerId}] Lỗi nghiêm trọng không thể phục hồi: ${error.message}`);
        return []; // Trả về mảng rỗng nếu có lỗi nghiêm trọng
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// --- HÀM MAIN ĐỂ CHẠY TỪ DÒNG LỆNH ---
(async () => {
    const args = process.argv.slice(2);
    if (args.length !== 4) {
        console.error("Cách dùng: node collector.js [keyword] [startPage] [endPage] [workerId]");
        process.exit(1);
    }
    const [keyword, startPageStr, endPageStr, workerId] = args;
    const startPage = parseInt(startPageStr, 10);
    const endPage = parseInt(endPageStr, 10);

    const results = await scrapeTopCV(keyword, startPage, endPage, workerId);

    if (results.length > 0) {
        const outputFilename = `results_worker_${workerId}.csv`;
        const csvData = stringify(results, { header: true });
        fs.writeFileSync(outputFilename, '\ufeff' + csvData);
        console.log(`[Worker ${workerId}] Đã lưu ${results.length} tin vào ${outputFilename}`);
    } else {
        console.log(`[Worker ${workerId}] Không thu thập được dữ liệu nào.`);
    }
})();

