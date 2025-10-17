// --- ĐIỆP VIÊN ĐƠN ĐỘC (SCRAPER) - PHIÊN BẢN TỐI THƯỢNG ---
// Cập nhật: Tích hợp anonymize-ua, fix selector, wait AJAX.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const AnonymizeUAPlugin = require('puppeteer-extra-plugin-anonymize-ua');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const axios = require('axios');

puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

const TARGET_KEYWORD = "ke-to-an";
const BROWSER_TIMEOUT = 120000;
const PAGE_LOAD_TIMEOUT = 60000;
const MAX_PAGES_TO_CHECK = 200;

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
        return `${BASE_URL}/tim-viec-lam-ke-toan-cr392cb393?type_keyword=1&page=${page}&category_family=r392~b393`;
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

async function discoverPagesByPaginateText(page) {
    const targetUrl = buildUrl(TARGET_KEYWORD, 1);
    console.error(`   -> [Tối ưu] Đang truy cập trang 1 để đọc tổng số trang...`);
    try {
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
        console.error(`   -> [Tối ưu] Không tìm thấy thông tin phân trang hoặc gặp lỗi: ${error.message}`);
        throw new Error("Không thể áp dụng phương pháp do thám tối ưu.");
    }
}

async function discoverPagesLinearly(page) {
    let lastKnownGoodPage = 1;
    for (let i = 1; i <= MAX_PAGES_TO_CHECK; i++) {
        const targetUrl = buildUrl(TARGET_KEYWORD, i);
        console.error(`   -> [Tuần tự] Đang thám hiểm trang ${i}...`);
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
            const content = await page.content();
            const $ = cheerio.load(content);
            const jobListings = $('div.job-item-search-result');
            if (jobListings.length === 0) {
                console.error(`   -> [Tuần tự] Trang ${i} không có jobs. Đã đến trang cuối.`);
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

async function discoverTotalPages(page) {
    console.error("\n--- [Điệp viên] Bắt đầu giai đoạn DO THÁM ---");
    try {
        console.error("   -> Đang thử chiến thuật TỐI ƯU (đọc trực tiếp)...");
        const totalPages = await discoverPagesByPaginateText(page);
        console.error(`[Điệp viên] Báo cáo tình báo: Phát hiện có tổng cộng ${totalPages} trang.`);
        return totalPages;
    } catch (error) {
        console.error(`   -> ${error.message} Chuyển sang chiến thuật tuần tự (Kế hoạch B).`);
        console.error("\n--- [Điệp viên] Kích hoạt Kế hoạch B bằng chiến thuật tuần tự ---");
        const totalPagesFallback = await discoverPagesLinearly(page);
        console.error(`[Điệp viên] Báo cáo tình báo: Phát hiện có tổng cộng ${totalPagesFallback} trang.`);
        return totalPagesFallback;
    }
}

async function initializeBrowser(proxy, chromePath) {
    if (!chromePath) throw new Error("Không nhận được 'Bản đồ Dẫn đường' (CHROME_PATH).");
    const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', proxy ? `--proxy-server=${proxy.host}:${proxy.port}` : ''];
    console.error(`\n[Điệp viên] Đang khởi tạo trình duyệt với ${proxy ? `danh tính ${proxy.host}` : 'không proxy'}...`);
    return await puppeteer.launch({
        headless: true,
        executablePath: chromePath,
        args: browserArgs.filter(Boolean),
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
        const chromePath = process.env.CHROME_PATH;
        let proxy = await getProxy(process.env.PROXY_API_KEY, process.env.PROXY_API_ENDPOINT);
        browser = await initializeBrowser(proxy, chromePath);
        let page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        const totalPages = await discoverTotalPages(page);
        console.error(`\n[Điệp viên] Do thám hoàn tất. Tổng cộng ${totalPages} trang.`);
        console.error("\n--- [Điệp viên] Bắt đầu giai đoạn KHAI THÁC ---");
        for (let i = 1; i <= totalPages; i++) {
            const targetUrl = buildUrl(TARGET_KEYWORD, i);
            console.error(`   -> Đang khai thác trang ${i}/${totalPages}...`);
            try {
                await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: PAGE_LOAD_TIMEOUT });
                await page.waitForFunction(() => document.querySelectorAll('div.job-item-search-result').length > 0, { timeout: 30000 });
                const content = await page.content();
                fs.writeFileSync(`debug_page_${i}.html`, content);
                console.error(`      -> Saved debug HTML: debug_page_${i}.html`);
                const $ = cheerio.load(content);
                const jobListings = $('div.job-item-search-result');
                if (jobListings.length === 0) {
                    console.error(`   -> Cảnh báo: Trang ${i} không có nội dung. Dừng khai thác.`);
                    break;
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
                await sleep(randomDelay(18000, 25000));
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
        const timestamp = new Date().toLocaleString('vi-VN', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh'}).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        finalFilename = `data/topcv_${TARGET_KEYWORD}_${timestamp}.csv`;
        jobsCount = allJobs.length;
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${jobsCount} tin duy nhất vào ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }
    const output = `jobs_count=${jobsCount}\nfinal_filename=${finalFilename}\n`;
    fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
}

ultimateScraper();
