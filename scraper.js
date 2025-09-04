// --- ĐIỆP VIÊN ĐƠN ĐỘC (SCRAPER) - PHIÊN BẢN "LỊCH THIỆP" ---
// Cập nhật: Tích hợp logic "làm nóng" (session warm-up) sau mỗi lần "biến hình".

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "ke-toan"; 
const BROWSER_TIMEOUT = 120000;
const PAGE_LOAD_TIMEOUT = 60000;
const MAX_PAGES_TO_CHECK = 200; 

// --- HÀM TIỆN ÍCH ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

// --- HÀM XÂY DỰNG URL ---
function buildUrl(keyword, page) {
    const BASE_URL = "https://www.topcv.vn";
    if (keyword === 'ke-toan') {
        return `${BASE_URL}/tim-viec-lam-ke-toan-cr392cb393?type_keyword=1&page=${page}&category_family=r392~b393`;
    } else {
        return `${BASE_URL}/tim-viec-lam-${keyword}?type_keyword=1&page=${page}&sba=1`;
    }
}

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
        console.error(`-> [Điệp viên] Lỗi nghiêm trọng khi yêu cầu proxy mới: ${error.message}`);
        throw error;
    }
}

// --- HÀM DO THÁM ---
async function discoverTotalPages(page) {
    let lastKnownGoodPage = 1;
    console.error("\n--- [Điệp viên] Bắt đầu giai đoạn DO THÁM ---");

    for (let i = 1; i <= MAX_PAGES_TO_CHECK; i++) {
        const targetUrl = buildUrl(TARGET_KEYWORD, i);
        console.error(`   -> Đang thám hiểm trang ${i}...`);
        
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
            const currentUrl = page.url();
            const urlParams = new URLSearchParams(new URL(currentUrl).search);
            const actualPage = parseInt(urlParams.get('page') || '1', 10);

            if (actualPage < i) {
                console.error(`   -> Đã đến rìa thế giới! Bị đưa về trang ${actualPage} khi cố gắng đến trang ${i}.`);
                break;
            }
            lastKnownGoodPage = i;
        } catch (error) {
             console.error(`   -> Gặp lỗi khi thám hiểm trang ${i}: ${error.message}. Coi như đã đến trang cuối.`);
             break;
        }
    }
    console.error(`[Điệp viên] Báo cáo tình báo: Phát hiện có tổng cộng ${lastKnownGoodPage} trang.`);
    return lastKnownGoodPage;
}

// --- HÀM KHỞI TẠO VÀ "LÀM NÓNG" TRÌNH DUYỆT ---
async function initializeAndWarmUpBrowser(proxy, chromePath) {
     if (!proxy) throw new Error("Không có proxy để khởi tạo trình duyệt.");
     const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--proxy-server=${proxy.host}:${proxy.port}`,
    ];
    console.error(`\n[Điệp viên] Đang khởi tạo trình duyệt MỚI với danh tính ${proxy.host}...`);
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: chromePath,
        args: browserArgs,
        ignoreHTTPSErrors: true,
        timeout: BROWSER_TIMEOUT
    });

    // --- LOGIC MỚI: "LÀM NÓNG" ---
    const page = await browser.newPage();
    try {
        console.error("   -> [Làm nóng] Bắt đầu 'nghi thức chào hỏi'...");
        await page.goto("https://www.topcv.vn/", { waitUntil: 'networkidle2', timeout: 45000 });
        await sleep(randomDelay(2000, 4000));
        await page.mouse.move(randomDelay(100, 500), randomDelay(100, 500));
        await page.evaluate(() => window.scrollBy(0, randomDelay(100, 300)));
        console.error("   -> [Làm nóng] 'Nghi thức chào hỏi' hoàn tất. Phiên làm việc đã được tin cậy.");
    } catch (e) {
        console.error(`   -> [Làm nóng] Gặp lỗi nhỏ khi làm nóng: ${e.message}. Vẫn tiếp tục nhiệm vụ.`);
    } finally {
        await page.close(); // Đóng tab "làm nóng"
    }

    return browser;
}

// --- HÀM CHÍNH: "ĐIỆP VIÊN LỊCH THIỆP" ---
async function politeScraper() {
    console.error("--- CHIẾN DỊCH 'ĐIỆP VIÊN LỊCH THIỆP' BẮT ĐẦU ---");
    let browser;
    const allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";

    try {
        const CHROME_EXECUTABLE_PATH = process.env.CHROME_PATH;
        if (!CHROME_EXECUTABLE_PATH) {
            throw new Error("Nhiệm vụ thất bại: Không nhận được 'Bản đồ Dẫn đường' (CHROME_PATH).");
        }

        let proxy = await getProxy(process.env.PROXY_API_KEY, process.env.PROXY_API_ENDPOINT);
        browser = await initializeAndWarmUpBrowser(proxy, CHROME_EXECUTABLE_PATH);

        let page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const totalPages = await discoverTotalPages(page);
        
        let pagesUntilNextChange = randomDelay(20, 40); // Tăng "độ bền" sau khi đã "làm nóng"
        console.error(`\n[Điệp viên] Độ bền nhân dạng ban đầu: ${pagesUntilNextChange} trang.`);

        console.error("\n--- [Điệp viên] Bắt đầu giai đoạn KHAI THÁC ---");
        for (let i = 1; i <= totalPages; i++) {
            
            if (pagesUntilNextChange <= 0) {
                console.error(`\n   -> [Điệp viên] Hết độ bền nhân dạng. Bắt đầu "biến hình"...`);
                await browser.close();

                proxy = await getProxy(process.env.PROXY_API_KEY, process.env.PROXY_API_ENDPOINT);
                browser = await initializeAndWarmUpBrowser(proxy, CHROME_EXECUTABLE_PATH);
                
                page = await browser.newPage();
                await page.setViewport({ width: 1920, height: 1080 });
                
                pagesUntilNextChange = randomDelay(20, 40);
                console.error(`   -> [Điệp viên] "Biến hình" thành công. Độ bền nhân dạng mới: ${pagesUntilNextChange} trang.`);
            }

            const targetUrl = buildUrl(TARGET_KEYWORD, i);
            console.error(`   -> Đang khai thác trang ${i}/${totalPages} (còn ${pagesUntilNextChange} trang nữa sẽ biến hình)...`);

            try {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
                const jobListSelector = 'div.job-list-search-result';
                await page.waitForSelector(jobListSelector, { timeout: 30000 });
                
                await sleep(2000);
                
                const content = await page.content();
                const $ = cheerio.load(content);
                const jobListings = $('div[class*="job-item"]');

                if (jobListings.length === 0 && i < totalPages) {
                     console.error(`   -> Cảnh báo: Trang ${i} không có nội dung. Chuyển sang trang tiếp theo.`);
                     pagesUntilNextChange--;
                     continue;
                }
                 
                jobListings.each((index, element) => {
                    // ... (logic trích xuất chi tiết giữ nguyên)
                });

                console.error(`   -> Đã thu thập ${jobListings.length} tin từ trang ${i}.`);
                pagesUntilNextChange--;
                
                await sleep(randomDelay(3000, 7000));

            } catch (error) {
                console.error(`   -> Lỗi khi xử lý trang ${i}: ${error.message}. Chuyển sang trang tiếp theo.`);
                pagesUntilNextChange--;
                continue;
            }
        }
    } catch (error) {
        console.error(`[Điệp viên] Nhiệm vụ thất bại không thể phục hồi: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
            console.error("\n[Điệp viên] Rút lui an toàn, đã đóng trình duyệt.");
        }
    }

    // ... (logic báo cáo và gửi output giữ nguyên)
}

politeScraper();

