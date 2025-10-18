// --- CẤU HÌNH ---
const TARGET_KEYWORD = "all-jobs"; // Có thể giữ để ghi log, nhưng không dùng trong URL
const BROWSER_TIMEOUT = 120000;
const PAGE_LOAD_TIMEOUT = 60000;
const MAX_PAGES_TO_CHECK = 200;

// --- HÀM TIỆN ÍCH ---
function buildUrl(page) {
    const BASE_URL = "https://www.topcv.vn";
    if (page === 1) {
        return `${BASE_URL}/tim-viec-lam-moi-nhat?sba=1`;
    } else {
        return `${BASE_URL}/tim-viec-lam-moi-nhat?type_keyword=1&page=${page}&sba=1`;
    }
}

// ... (giữ nguyên các hàm khác như getProxy, discoverPagesByPaginateText, v.v.)

async function ultimateScraper() {
    console.error("--- CHIẾN DỊCH 'ĐIỆP VIÊN TỐI THƯỢNG' BẮT ĐẦU ---");
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
        browser = await initializeBrowser(proxy, CHROME_EXECUTABLE_PATH);
        let page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9' });
        await page.setViewport({ width: 1920, height: 1080 });
        const totalPages = await discoverTotalPages(page); // Sử dụng hàm discoverTotalPages với URL mới
        const initialDelay = randomDelay(10000, 13500);
        console.error(`\n[Điệp viên] Do thám hoàn tất. Tạm nghỉ ${(initialDelay / 1000).toFixed(2)} giây...`);
        await sleep(initialDelay);
        let pagesUntilNextChange = randomDelay(10, 30);
        console.error(`[Điệp viên] Độ bền nhân dạng ban đầu: ${pagesUntilNextChange} trang.`);
        console.error("\n--- [Điệp viên] Bắt đầu giai đoạn KHAI THÁC ---");
        const collectionStrategies = [
            // ... (giữ nguyên các chiến thuật quan sát)
        ];
        for (let i = 1; i <= totalPages; i++) {
            if (pagesUntilNextChange <= 0) {
                // ... (giữ nguyên logic biến hình)
            }
            const targetUrl = buildUrl(i); // Sử dụng page thay vì buildUrl với keyword
            console.error(`   -> Đang khai thác trang ${i}/${totalPages} (còn ${pagesUntilNextChange} trang nữa sẽ biến hình)...`);
            try {
                await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: PAGE_LOAD_TIMEOUT });
                // ... (giữ nguyên logic khai thác job)
            } catch (error) {
                // ... (giữ nguyên xử lý lỗi)
            }
        }
    } catch (error) {
        // ... (giữ nguyên catch và finally)
    } finally {
        // ... (giữ nguyên finally)
    }
    if (allJobs.length > 0) {
        // ... (giữ nguyên xử lý file CSV, dùng TARGET_KEYWORD nếu cần)
    }
    // ... (giữ nguyên output)
}

async function discoverTotalPages(page) {
    console.error("\n--- [Điệp viên] Bắt đầu giai đoạn DO THÁM ---");
    try {
        console.error("   -> Đang thử chiến thuật TỐI ƯU (đọc trực tiếp)...");
        const targetUrl = buildUrl(1); // Trang 1 để đọc tổng số trang
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
        const selector = '#job-listing-paginate-text';
        await page.waitForSelector(selector, { timeout: 10000 });
        const paginateText = await page.$eval(selector, el => el.innerText);
        const parts = paginateText.split('/');
        const totalPages = parseInt(parts[1].trim(), 10);
        if (!isNaN(totalPages) && totalPages > 0) {
            return totalPages;
        }
    } catch (error) {
        console.error(`   -> ${error.message} Chuyển sang các chiến thuật ngẫu nhiên (Kế hoạch B).`);
    }
    const fallbackStrategies = [discoverPagesLinearly, discoverPagesByBinarySearch, discoverPagesInReverse];
    const selectedStrategy = fallbackStrategies[Math.floor(Math.random() * fallbackStrategies.length)];
    console.error(`\n--- [Điệp viên] Kích hoạt Kế hoạch B bằng chiến thuật ngẫu nhiên: "${selectedStrategy.name}" ---`);
    // Cập nhật các hàm fallback để dùng buildUrl(page)
    async function discoverPagesLinearly(p) {
        let lastKnownGoodPage = 1;
        for (let i = 1; i <= MAX_PAGES_TO_CHECK; i++) {
            const targetUrl = buildUrl(i);
            console.error(`   -> [Tuần tự] Đang thám hiểm trang ${i}...`);
            try {
                await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
                const content = await p.content();
                const $ = cheerio.load(content);
                const currentUrl = p.url();
                const urlParams = new URLSearchParams(new URL(currentUrl).search);
                const actualPage = parseInt(urlParams.get('page') || '1', 10);
                if (actualPage < i || $('div[class*="job-item"]').length === 0) {
                    console.error(`   -> [Tuần tự] Bị đưa về trang ${actualPage} hoặc no jobs. Đã đến trang cuối.`);
                    break;
                }
                lastKnownGoodPage = i;
            } catch (error) {
                console.error(`   -> [Tuần tự] Gặp lỗi khi thám hiểm trang ${i}: ${error.message}`);
                break;
            }
        }
        return lastKnownGoodPage;
    }
    async function discoverPagesByBinarySearch(p) {
        let low = 1, high = MAX_PAGES_TO_CHECK, lastGood = 1;
        while (low <= high) {
            const mid = Math.floor(low + (high - low) / 2);
            if (mid === 0) break;
            const targetUrl = buildUrl(mid);
            console.error(`   -> [Nhị phân] Đang kiểm tra trang ${mid} (trong khoảng ${low}-${high})...`);
            try {
                await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
                const content = await p.content();
                const $ = cheerio.load(content);
                const currentUrl = p.url();
                const urlParams = new URLSearchParams(new URL(currentUrl).search);
                const actualPage = parseInt(urlParams.get('page') || '1', 10);
                if (actualPage >= mid && $('div[class*="job-item"]').length > 0) {
                    console.error(`      -> Trang ${mid} tồn tại với jobs.`);
                    lastGood = mid;
                    low = mid + 1;
                } else {
                    console.error(`      -> Trang ${mid} không tồn tại hoặc no jobs.`);
                    high = mid - 1;
                }
            } catch (error) {
                console.error(`      -> Gặp lỗi ở trang ${mid}: ${error.message}`);
                high = mid - 1;
            }
        }
        return lastGood;
    }
    async function discoverPagesInReverse(p) {
        for (let i = MAX_PAGES_TO_CHECK; i >= 1; i--) {
            const targetUrl = buildUrl(i);
            console.error(`   -> [Đảo ngược] Đang kiểm tra từ trang ${i}...`);
            try {
                await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
                const content = await p.content();
                const $ = cheerio.load(content);
                const currentUrl = p.url();
                const urlParams = new URLSearchParams(new URL(currentUrl).search);
                const actualPage = parseInt(urlParams.get('page') || '1', 10);
                if (actualPage >= i && $('div[class*="job-item"]').length > 0) {
                    console.error(`   -> [Đảo ngược] Trang ${i} hợp lệ. Đây là trang cuối cùng.`);
                    return i;
                }
            } catch (error) {
                console.error(`   -> [Đảo ngược] Gặp lỗi khi kiểm tra trang ${i}: ${error.message}`);
                continue;
            }
        }
        return 1;
    }
    const totalPagesFallback = await selectedStrategy(page);
    console.error(`[Điệp viên] Báo cáo tình báo: Phát hiện có tổng cộng ${totalPagesFallback} trang.`);
    return totalPagesFallback;
}
