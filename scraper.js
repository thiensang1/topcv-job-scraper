// Mã nguồn gốc từ: https://github.com/thiensang1/topcv-job-scraper
// Đã được bổ sung chức năng convertPostTimeToDate theo yêu cầu.

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');

const TARGET_KEYWORDS = ['ke-toan'];
const PAGES_PER_KEYWORD = 200; // Giới hạn số trang quét cho mỗi từ khóa

// --- HÀM ĐƯỢC BỔ SUNG ---
function convertPostTimeToDate(timeString) {
    if (!timeString) return null;
    const now = new Date();
    // Chuẩn hóa chuỗi đầu vào
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
        // Xử lý định dạng dd-mm-yyyy
        const parts = normalizedString.split('-');
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    
    // Nếu không khớp các trường hợp trên (ví dụ: "hôm nay"), trả về ngày hiện tại
    // Định dạng lại theo chuẩn YYYY-MM-DD
    return now.toISOString().split('T')[0];
}
// --- KẾT THÚC HÀM ĐƯỢC BỔ SUNG ---


async function scrapeTopCVByKeyword(keyword, pageNum) {
    const base_url = "https://www.topcv.vn";
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    let targetUrl;
    if (keyword === 'ke-toan') {
        targetUrl = `${base_url}/tim-viec-lam-ke-toan-c39?page=${pageNum}`;
    } else {
        targetUrl = `${base_url}/tim-viec-lam-${keyword}?page=${pageNum}`;
    }

    await page.goto(targetUrl);

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
        
        // --- THAY ĐỔI TRONG PHẦN TRÍCH XUẤT ---
        // Lấy chuỗi thời gian gốc
        const rawTime = $(element).find('span.time').text().trim();
        // Chuyển đổi sang định dạng YYYY-MM-DD
        const postDate = convertPostTimeToDate(rawTime);
        // --- KẾT THÚC THAY ĐỔI ---

        processedJobs.push({
            'keyword': keyword,
            'title': title,
            'link': link,
            'company': company,
            'salary': salary,
            'location': location,
            'thời gian đăng': postDate, // Sử dụng ngày đã được định dạng
        });
    });

    await browser.close();
    return processedJobs;
}

(async () => {
    let allResults = [];
    for (const keyword of TARGET_KEYWORDS) {
        for (let i = 1; i <= PAGES_PER_KEYWORD; i++) {
            console.log(`Đang quét từ khóa '${keyword}' trang ${i}...`);
            const jobs = await scrapeTopCVByKeyword(keyword, i);
            if (jobs.length === 0) {
                console.log(`Không tìm thấy việc làm nào ở trang ${i}. Dừng lại.`);
                break;
            }
            allResults.push(...jobs);
        }
    }

    if (allResults.length > 0) {
        const csvData = stringify(allResults, { header: true });
        fs.writeFileSync('topcv_jobs.csv', '\ufeff' + csvData); // Thêm BOM để Excel đọc UTF-8
        console.log(`Đã quét xong! Lưu ${allResults.length} việc làm vào file topcv_jobs.csv`);
    } else {
        console.log('Không quét được dữ liệu nào.');
    }
})();

