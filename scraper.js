// --- PHIÊN BẢN SCRAPER CUỐI CÙNG: DỰA TRÊN MÃ NGUỒN CỦA BẠN VÀ TÍCH HỢP HÀM CHUYỂN ĐỔI NGÀY THÁNG ---

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');

const PROXY_SERVER = process.env.PROXY_URL;
const TARGET_KEYWORDS = ['ke-toan'];
const PAGES_PER_KEYWORD = 200;

function convertPostTimeToDate(timeString) {
    if (!timeString) return null;
    const now = new Date();
    const normalizedString = timeString.toLowerCase().trim();
    if (normalizedString.includes('hôm qua')) {
        now.setDate(now.getDate() - 1);
    } else if (normalizedString.includes('hôm kia')) {
        now.setDate(now.getDate() - 2);
    } else if (normalizedString.includes('ngày trước')) {
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

async function scrapeTopCVByKeyword(keyword, pageNum) {
    const base_url = "https://www.topcv.vn";
    const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    };
    if (PROXY_SERVER) {
        console.log(`Đang sử dụng proxy...`);
        launchOptions.args.push(`--proxy-server=${PROXY_SERVER}`);
    }
    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    let targetUrl;
    if (keyword === 'ke-toan') {
        targetUrl = `${base_url}/tim-viec-lam-ke-toan-c39?page=${pageNum}`;
    } else {
        targetUrl = `${base_url}/tim-viec-lam-${keyword}?page=${pageNum}`;
    }
    try {
        await page.goto(targetUrl, { timeout: 60000 });
    } catch (error) {
        console.error(`Không thể truy cập trang: ${error.message}`);
        await browser.close();
        return [];
    }
    const content = await page.content();
    const $ = cheerio.load(content);
    const jobListings = $('div.job-item');
    const processedJobs = [];
    jobListings.each((index, element) => {
        const title = $(element).find('h3.title a').text().trim();
        const link = base_url + $(element).find('h3.title a').attr('href');
        const company = $(element).find('a.company').text().trim();
        const salary = $(element).find('label.title-salary').text().trim();
        const location = $(element).find('label.address').text().trim();
        const rawTime = $(element).find('span.time').text().trim();
        const postDate = convertPostTimeToDate(rawTime);
        processedJobs.push({
            'keyword': keyword, 'title': title, 'link': link, 'company': company,
            'salary': salary, 'location': location, 'thời gian đăng': postDate,
        });
    });
    await browser.close();
    return processedJobs;
}

(async () => {
    let allJobs = [];
    const TARGET_KEYWORD = TARGET_KEYWORDS[0];

    for (let i = 1; i <= PAGES_PER_KEYWORD; i++) {
        console.log(`Đang quét từ khóa '${TARGET_KEYWORD}' trang ${i}...`);
        const jobs = await scrapeTopCVByKeyword(TARGET_KEYWORD, i);
        if (jobs.length === 0) {
            console.log(`Không tìm thấy việc làm nào ở trang ${i}. Dừng lại.`);
            break;
        }
        allJobs.push(...jobs);
    }

    if (allJobs.length > 0) {
        // --- DÒNG SỬA LỖI QUAN TRỌNG NHẤT ---
        const timestamp = new Date().toLocaleString('vi-VN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: 'Asia/Ho_Chi_Minh'
        }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        
        const finalFilename = `data/topcv_${TARGET_KEYWORD}_${timestamp}.csv`;
        const jobsCount = allJobs.length;
        
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${jobsCount} tin việc làm vào file ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }
})();

