// --- ĐIỆP VIÊN ĐƠN ĐỘC (SCRAPER) - PHIÊN BẢN "NHỊP ĐIỆU" ---
// Cập nhật: Thêm các khoảng nghỉ chiến lược để mô phỏng hành vi của con người.

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
const randomDelay = (min, max) => Math.random() * (max - min) + min;

// --- HÀM XÂY DỰNG URL (Nguồn Chân lý Duy nhất) ---
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
        console.error("-> [Điệp viên] Đang yêu cầu một danh tính proxy mới từ API...");
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

// --- HÀM DO THÁM (Logic 'Thám tử Dày dạn') ---
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

// --- HÀM CHÍNH: "ĐIỆP VIÊN ĐƠN ĐỘC" ---
async function loneWolfScraper() {
    console.error("--- CHIẾN DỊCH 'ĐIỆP VIÊN ĐƠN ĐỘC' BẮT ĐẦU ---");
    let browser;
    const allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";

    try {
        const CHROME_EXECUTABLE_PATH = process.env.CHROME_PATH;
        if (!CHROME_EXECUTABLE_PATH) {
            throw new Error("Nhiệm vụ thất bại: Không nhận được 'Bản đồ Dẫn đường' (CHROME_PATH).");
        }

        const proxy = await getProxy(process.env.PROXY_API_KEY, process.env.PROXY_API_ENDPOINT);
        if (!proxy) throw new Error("Không thể lấy proxy, nhiệm vụ thất bại.");

        const browserArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            `--proxy-server=${proxy.host}:${proxy.port}`,
        ];

        console.error(`[Điệp viên] Đang khởi tạo trình duyệt với danh tính ${proxy.host}...`);
        
        browser = await puppeteer.launch({
            headless: true,
            executablePath: CHROME_EXECUTABLE_PATH,
            args: browserArgs,
            ignoreHTTPSErrors: true,
            timeout: BROWSER_TIMEOUT
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const totalPages = await discoverTotalPages(page);

        // --- LOGIC MỚI: "NHỊP ĐIỆU CON NGƯỜI" (Hít thở sâu) ---
        const initialDelay = randomDelay(5000, 10000);
        console.error(`\n[Điệp viên] Do thám hoàn tất. Tạm nghỉ ${(initialDelay / 1000).toFixed(2)} giây để phân tích tình hình...`);
        await sleep(initialDelay);

        console.error("\n--- [Điệp viên] Bắt đầu giai đoạn KHAI THÁC ---");
        for (let i = 1; i <= totalPages; i++) {
            const targetUrl = buildUrl(TARGET_KEYWORD, i);
            console.error(`   -> Đang khai thác trang ${i}/${totalPages}...`);

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
                     continue;
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
                    
                    allJobs.push({
                        'keyword': TARGET_KEYWORD,
                        'title': titleTag.text().trim() || null,
                        'link': titleTag.attr('href') ? `https://www.topcv.vn${titleTag.attr('href')}` : null,
                        'company': companyText,
                        'salary': salaryTag.text().trim() || 'Thỏa thuận',
                        'Nơi làm việc': locationTag.text().trim() || null,
                        'thời gian đăng': dateText,
                        'Kinh nghiệm làm việc tối thiểu': (expTag.text() || '').trim() || null,
                    });
                });

                console.error(`   -> Đã thu thập ${jobListings.length} tin từ trang ${i}.`);
                
                // --- LOGIC MỚI: "NHỊP ĐIỆU CON NGƯỜI" (Nghỉ ngơi giữa các chặng) ---
                const betweenPagesDelay = randomDelay(3000, 7000);
                console.error(`   -> Tạm nghỉ ${(betweenPagesDelay / 1000).toFixed(2)} giây trước khi sang trang tiếp theo...`);
                await sleep(betweenPagesDelay);


            } catch (error) {
                console.error(`   -> Lỗi khi xử lý trang ${i}: ${error.message}. Chuyển sang trang tiếp theo.`);
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

    if (allJobs.length > 0) {
        const date = new Date().toLocaleDateString('vi-VN', {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Ho_Chi_Minh'}).replace(/\//g, '-');
        finalFilename = `data/topcv_${TARGET_KEYWORD}_${date}.csv`;
        jobsCount = allJobs.length;
        
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${jobsCount} tin duy nhất vào ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }
    
    // Gửi output cho GitHub Actions
    const output = `jobs_count=${jobsCount}\nfinal_filename=${finalFilename}\n`;
    fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
}

// Bắt đầu chiến dịch
loneWolfScraper();

