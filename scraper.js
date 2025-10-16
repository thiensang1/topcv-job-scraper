// --- ĐIỆP VIÊN ĐƠN ĐỘC (SCRAPER) - PHIÊN BẢN TỐI THƯỢNG ---
// Cập nhật: Fix parse job-listing-paginate-text, handle &nbsp;, linh hoạt regex.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "ke-to-an"; 
const BROWSER_TIMEOUT = 120000;
const PAGE_LOAD_TIMEOUT = 60000;
const MAX_PAGES_TO_CHECK = 150; // Đủ cover ~113 trang

// --- HÀM TIỆN ÍCH ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

function convertPostTimeToDate(timeString) {
    if (!timeString) return null;
    const now = new Date();
    const normalizedString = timeString.toLowerCase().trim();
    if (normalizedString.includes('hôm qua')) { now.setDate(now.getDate() - 1); } 
    else if (normalizedString.includes('hôm kia')) { now.setDate(now.getDate() - 2); } 
    else if (normalizedString.includes('ngày trước')) {
        const days = parseInt(normalizedString.match(/\d+/)[0]);
        if (!isNaN(days)) now.setDate(now.getDate() - days);
    } else if (normalizedString.includes('tuần trước')) {
        const weeks = parseInt(normalizedString.match(/\d+/)[0]);
        if (!isNaN(weeks)) now.setDate(now.getDate() - (weeks * 7));
    } else if (normalizedString.includes('tháng trước')) {
        const months = parseInt(normalizedString.match(/\d+/)[0]);
        if (!isNaN(months)) now.setMonth(now.getMonth() - months);
    } else if (normalizedString.includes('năm trước')) {
        const years = parseInt(normalizedString.match(/\d+/)[0]);
        if (!isNaN(years)) now.setFullYear(now.getFullYear() - years);
    } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(normalizedString)) {
        const parts = normalizedString.split('-');
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return now.toISOString().split('T')[0];
}

function buildUrl(keyword, page) {
    const BASE_URL = "https://www.topcv.vn";
    if (keyword === 'ke-to-an') {
        return `${BASE_URL}/tim-viec-lam-ke-to-an-cr392cb393?type_keyword=1&page=${page}&category_family=r392~b393`;
    } else {
        return `${BASE_URL}/tim-viec-lam-${keyword}?type_keyword=1&page=${page}&sba=1`;
    }
}

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

// --- CÁC KỊCH BẢN DO THÁM ---

// Kế hoạch A: Parse từ job-listing-paginate-text, handle &nbsp;, linh hoạt regex
async function discoverPagesByPaginateText(page) {
    const targetUrl = buildUrl(TARGET_KEYWORD, 1);
    console.error(`   -> [Tối ưu] Đang truy cập trang 1 để đọc tổng số trang...`);
    try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
        const paginateText = await page.evaluate(() => {
            const span = document.querySelector('#job-listing-paginate-text');
            if (span) return span.innerText.replace(/\u00A0/g, ' '); // Thay &nbsp; bằng space
            const elements = document.querySelectorAll('title, h1, p, div');
            for (let el of elements) {
                if (el.innerText.includes('Tìm thấy') || el.innerText.includes('Tuyển dụng')) {
                    return el.innerText.replace(/\u00A0/g, ' ');
                }
            }
            return '';
        });
        console.error(`   -> [Tối ưu] Tìm thấy: "${paginateText}"`);
        // Thử parse từ job-listing-paginate-text trước
        let match = paginateText.match(/\/ (\d+) trang/) || paginateText.match(/trang \d+ \/ (\d+)/);
        let totalPages = match ? parseInt(match[1]) : 0;
        // Fallback parse từ title hoặc h1 nếu cần
        if (totalPages === 0) {
            match = paginateText.match(/Tìm thấy (\d+(?:\.\d+)?) tin đăng/) || paginateText.match(/Tuyển dụng (\d+(?:\.\d+)?) việc làm/);
            if (match) {
                const totalJobs = parseInt(match[1].replace(/\./g, ''));
                totalPages = Math.ceil(totalJobs / 20);
            }
        }
        console.error(`   -> [Tối ưu] Tổng pages: ${totalPages}`);
        if (!isNaN(totalPages) && totalPages > 0) {
            return totalPages;
        }
        throw new Error("Không parse được số trang từ job-listing-paginate-text hoặc fallback.");
    } catch (error) {
        console.error(`   -> [Tối ưu] Lỗi: ${error.message}`);
        throw new Error("Không thể áp dụng phương pháp do thám tối ưu.");
    }
}

// Kế hoạch B: Linear (đã có check length từ trước, giữ nguyên)
async function discoverPagesLinearly(page) { 
    let lastKnownGoodPage = 1;
    for (let i = 1; i <= MAX_PAGES_TO_CHECK; i++) {
        const targetUrl = buildUrl(TARGET_KEYWORD, i);
        console.error(`   -> [Tuần tự] Đang thám hiểm trang ${i}...`);
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
            const content = await page.content();
            const $ = cheerio.load(content);
            const currentUrl = page.url();
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

// Kế hoạch B: Binary (đã có check length, giữ nguyên)
async function discoverPagesByBinarySearch(page) { 
    let low = 1, high = MAX_PAGES_TO_CHECK, lastGood = 1;
    while (low <= high) {
        const mid = Math.floor(low + (high - low) / 2);
        if (mid === 0) break;
        const targetUrl = buildUrl(TARGET_KEYWORD, mid);
        console.error(`   -> [Nhị phân] Đang kiểm tra trang ${mid} (trong khoảng ${low}-${high})...`);
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
            const content = await page.content();
            const $ = cheerio.load(content);
            const currentUrl = page.url();
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

// Kế hoạch B: Reverse (giữ nguyên)
async function discoverPagesInReverse(page) { 
    for (let i = MAX_PAGES_TO_CHECK; i >= 1; i--) {
        const targetUrl = buildUrl(TARGET_KEYWORD, i);
        console.error(`   -> [Đảo ngược] Đang kiểm tra từ trang ${i}...`);
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
            const content = await page.content();
            const $ = cheerio.load(content);
            const currentUrl = page.url();
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

// --- HÀM DO THÁM CHÍNH ---
async function discoverTotalPages(page) {
    console.error("\n--- [Điệp viên] Bắt đầu giai đoạn DO THÁM ---");
    
    try {
        console.error("   -> Đang thử chiến thuật TỐI ƯU (đọc trực tiếp)...");
        const totalPages = await discoverPagesByPaginateText(page);
        console.error(`[Điệp viên] Báo cáo tình báo: Phát hiện có tổng cộng ${totalPages} trang.`);
        return totalPages;
    } catch (error) {
        console.error(`   -> ${error.message} Chuyển sang các chiến thuật ngẫu nhiên (Kế hoạch B).`);
    }

    const fallbackStrategies = [discoverPagesLinearly, discoverPagesByBinarySearch, discoverPagesInReverse];
    const selectedStrategy = fallbackStrategies[Math.floor(Math.random() * fallbackStrategies.length)];
    
    console.error(`\n--- [Điệp viên] Kích hoạt Kế hoạch B bằng chiến thuật ngẫu nhiên: "${selectedStrategy.name}" ---`);
    const totalPagesFallback = await selectedStrategy(page);
    console.error(`[Điệp viên] Báo cáo tình báo: Phát hiện có tổng cộng ${totalPagesFallback} trang.`);
    return totalPagesFallback;
}

async function initializeBrowser(proxy, chromePath) {
    if (!proxy) throw new Error("Không có proxy để khởi tạo trình duyệt.");
    const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', `--proxy-server=${proxy.host}:${proxy.port}`];
    console.error(`\n[Điệp viên] Đang khởi tạo trình duyệt với danh tính ${proxy.host}...`);
    return await puppeteer.launch({
        headless: true,
        executablePath: chromePath,
        args: browserArgs,
        ignoreHTTPSErrors: true,
        timeout: BROWSER_TIMEOUT
    });
}

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
        const totalPages = await discoverTotalPages(page);
        const initialDelay = randomDelay(10000, 13500);
        console.error(`\n[Điệp viên] Do thám hoàn tất. Tạm nghỉ ${(initialDelay / 1000).toFixed(2)} giây...`);
        await sleep(initialDelay);
        let pagesUntilNextChange = randomDelay(10, 30);
        console.error(`[Điệp viên] Độ bền nhân dạng ban đầu: ${pagesUntilNextChange} trang.`);
        console.error("\n--- [Điệp viên] Bắt đầu giai đoạn KHAI THÁC ---");
        const collectionStrategies = [
            async (p) => { console.error("      -> [Chiến thuật] Quan sát Toàn diện: Cuộn 1 lần xuống cuối."); await p.evaluate(() => { window.scrollBy(0, document.body.scrollHeight); }); await sleep(randomDelay(500, 1000)); return await p.content(); },
            async (p) => { console.error("      -> [Chiến thuật] Người đọc từng đoạn: Cuộn từ từ theo nhiều bước."); const steps = randomDelay(3, 5); for (let s = 0; s < steps; s++) { await p.evaluate((a) => { window.scrollBy(0, a); }, randomDelay(300, 600)); await sleep(randomDelay(400, 800)); } await p.evaluate(() => { window.scrollBy(0, document.body.scrollHeight); }); await sleep(randomDelay(500, 1000)); return await p.content(); },
            async (p) => { console.error("      -> [Chiến thuật] Người lướt vội vã: Cuộn nhanh xuống và cuộn ngược lại."); await p.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); }); await sleep(randomDelay(600, 1200)); const ratio = Math.random() * 0.5 + 0.3; await p.evaluate((r) => { window.scrollTo(0, document.body.scrollHeight * r); }, ratio); await sleep(randomDelay(500, 1000)); return await p.content(); }
        ];
        for (let i = 1; i <= totalPages; i++) {
            if (pagesUntilNextChange <= 0) {
                console.error(`\n   -> [Điệp viên] Hết độ bền nhân dạng. Bắt đầu "biến hình"...`);
                await browser.close();
                proxy = await getProxy(process.env.PROXY_API_KEY, process.env.PROXY_API_ENDPOINT);
                browser = await initializeBrowser(proxy, CHROME_EXECUTABLE_PATH);
                page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36');
                await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9' });
                await page.setViewport({ width: 1920, height: 1080 });
                pagesUntilNextChange = randomDelay(10, 30);
                console.error(`   -> [Điệp viên] "Biến hình" thành công. Độ bền nhân dạng mới: ${pagesUntilNextChange} trang.`);
            }
            const targetUrl = buildUrl(TARGET_KEYWORD, i);
            console.error(`   -> Đang khai thác trang ${i}/${totalPages} (còn ${pagesUntilNextChange} trang nữa sẽ biến hình)...`);
            try {
                await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: PAGE_LOAD_TIMEOUT });
                const jobListSelector = 'div.job-list-search-result';
                console.error("      -> Bắt đầu giai đoạn 'quan sát' để chờ trang ổn định...");
                await page.waitForSelector('div.job-item-search-result', { timeout: 30000 });
                let previousHtml = '', currentHtml = '', stabilityCounter = 0;
                const requiredStableChecks = 5;
                for (let check = 0; check < 30; check++) {
                    currentHtml = await page.$eval(jobListSelector, element => element.innerHTML);
                    if (currentHtml.replace(/\s/g, '') === previousHtml.replace(/\s/g, '') && currentHtml.length > 100) {
                        stabilityCounter++;
                        console.error(`         - Trang đã ổn định (lần ${stabilityCounter}/${requiredStableChecks})...`);
                        if (stabilityCounter >= requiredStableChecks) break;
                    } else {
                        stabilityCounter = 0;
                    }
                    previousHtml = currentHtml;
                    await sleep(3000);
                }
                if (stabilityCounter < requiredStableChecks) {
                    throw new Error("Trang không ổn định, có thể đã bị chặn hoặc không có nội dung.");
                }
                console.error("      -> Trang đã ổn định. Dữ liệu chi tiết đã được tải.");
                const selectedCollectionStrategy = collectionStrategies[Math.floor(Math.random() * collectionStrategies.length)];
                await selectedCollectionStrategy(page);
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await sleep(5000);
                const content = await page.content();
                fs.writeFileSync(`debug_page_${i}.html`, content);
                console.error(`      -> Saved debug HTML: debug_page_${i}.html`);
                const $ = cheerio.load(content);
                let jobListings = $('div[class*="job-item"]');
                if (jobListings.length === 0) {
                    jobListings = $('div.job-item-search-result');
                    console.error("      -> Using fallback selector div.job-item-search-result");
                }
                if (jobListings.length === 0) {
                    console.error(`   -> Cảnh báo: Trang ${i} không có nội dung. Tiếp tục trang tiếp theo.`);
                    pagesUntilNextChange--;
                    continue;
                }
                jobListings.each((index, element) => {
                    const jobId = $(element).attr('data-job-id') || null;
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
                        'job_id': jobId,
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
                console.error(`   -> Đã thu thập ${jobListings.length} tin từ trang ${i}. Tổng allJobs: ${allJobs.length}`);
                pagesUntilNextChange--;
                const betweenPagesDelay = randomDelay(18000, 25000);
                await sleep(betweenPagesDelay);
            } catch (error) {
                console.error(`   -> Lỗi khi xử lý trang ${i}: ${error.message}. Tiếp tục trang tiếp theo.`);
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
    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh'}).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        finalFilename = `data/topcv_${TARGET_KEYWORD}_${timestamp}.csv`;
        jobsCount = allJobs.length;
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${jobsCount} tin duy nhất vào ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
        finalFilename = ''; // Explicit empty để skip commit
    }
    const output = `jobs_count=${jobsCount}\nfinal_filename=${finalFilename}\n`;
    fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
}

ultimateScraper();
