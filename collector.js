// --- CÔNG NHÂN KHAI THÁC (COLLECTOR SCRIPT) - PHIÊN BẢN PROXY ---
// Nhiệm vụ: Thu thập dữ liệu từ một khoảng trang được giao (ví dụ: trang 1-10).
// Hoạt động như một "đặc vụ nằm vùng" thông qua proxy chuyên nghiệp.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const { parse, format, subDays, subHours, subMinutes } = require('date-fns');

puppeteer.use(StealthPlugin());

// --- NÂNG CẤP: Hàm chuyển đổi thời gian thông minh ---
function convertPostedDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    
    const now = new Date();
    const cleanedString = dateString.toLowerCase().trim();

    try {
        if (cleanedString.includes('hôm qua')) {
            return format(subDays(now, 1), 'dd-MM-yyyy');
        }
        if (cleanedString.includes('hôm nay')) {
            return format(now, 'dd-MM-yyyy');
        }
        
        const daysAgoMatch = cleanedString.match(/(\d+)\s+ngày\s+trước/);
        if (daysAgoMatch) {
            return format(subDays(now, parseInt(daysAgoMatch[1], 10)), 'dd-MM-yyyy');
        }

        const hoursAgoMatch = cleanedString.match(/(\d+)\s+giờ\s+trước/);
        if (hoursAgoMatch) {
            return format(subHours(now, parseInt(hoursAgoMatch[1], 10)), 'dd-MM-yyyy');
        }

        const minutesAgoMatch = cleanedString.match(/(\d+)\s+phút\s+trước/);
        if (minutesAgoMatch) {
            return format(subMinutes(now, parseInt(minutesAgoMatch[1], 10)), 'dd-MM-yyyy');
        }
        
        // Xử lý định dạng dd-mm-yyyy hoặc dd/mm/yyyy
        const specificDateMatch = cleanedString.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
        if (specificDateMatch) {
            const day = specificDateMatch[1].padStart(2, '0');
            const month = specificDateMatch[2].padStart(2, '0');
            const year = specificDateMatch[3];
            return `${day}-${month}-${year}`;
        }

    } catch (e) {
        // Nếu có lỗi, trả về chuỗi gốc để phân tích thủ công sau
        return dateString;
    }
    
    return dateString; // Trả về chuỗi gốc nếu không khớp định dạng nào
}


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapePage(driver, keyword, pageNum) {
    const base_url = "https://www.topcv.vn";
    const targetUrl = `${base_url}/tim-viec-lam-${keyword}-cr392cb393?type_keyword=1&page=${pageNum}&category_family=r392~b393`;
    
    await driver.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    
    const jobListSelector = 'div.job-list-search-result';
    await driver.waitForSelector(jobListSelector, { timeout: 30000 });
    
    // Giai đoạn "quan sát kiên nhẫn"
    let previousHtml = '';
    let currentHtml = '';
    let stabilityCounter = 0;
    const requiredStableChecks = 2;

    for (let i = 0; i < 10; i++) {
        currentHtml = await driver.$eval(jobListSelector, element => element.innerHTML);
        if (currentHtml.replace(/\s/g, '') === previousHtml.replace(/\s/g, '') && currentHtml.length > 0) {
            stabilityCounter++;
            if (stabilityCounter >= requiredStableChecks) break;
        } else {
            stabilityCounter = 0;
        }
        previousHtml = currentHtml;
        await sleep(2000);
    }
    
    if (stabilityCounter < requiredStableChecks) {
        throw new Error("Trang không ổn định, có thể đã bị chặn.");
    }
    
    await driver.evaluate(() => { window.scrollBy(0, document.body.scrollHeight); });
    await sleep(1000);

    const content = await driver.content();
    const $ = cheerio.load(content);
    const jobListings = $('div[class*="job-item"]');
    const processedJobs = [];

    jobListings.each((index, element) => {
        const titleTag = $(element).find('h3[class*="title"] a');
        const salaryTag = $(element).find('.title-salary');
        const locationTag = $(element).find('.city-text');
        const companyLogoTag = $(element).find('img.w-100.lazy');
        const dateContainerTag = $(element).find('span.hidden-on-quick-view');
        const expTag = $(element).find('.exp');
        
        let companyText = companyLogoTag.length ? companyLogoTag.attr('alt')?.trim() : null;
        let rawDateText = null;
        if (dateContainerTag.length) {
            const nextNode = dateContainerTag[0].nextSibling;
            if (nextNode && nextNode.type === 'text') {
                rawDateText = nextNode.data.trim();
            }
        }
        
        processedJobs.push({
            'keyword': keyword,
            'title': titleTag.text().trim() || null,
            'link': titleTag.attr('href') ? `${base_url}${titleTag.attr('href')}` : null,
            'company': companyText,
            'salary': salaryTag.text().trim() || 'Thỏa thuận',
            'Nơi làm việc': locationTag.text().trim() || null,
            'thời gian đăng': convertPostedDate(rawDateText), // Sử dụng hàm chuyển đổi
            'Kinh nghiệm làm việc tối thiểu': expTag.text().trim() || null,
        });
    });

    return processedJobs;
}

(async () => {
    // Đọc các tham số được truyền vào từ GitHub Actions
    const [,, keyword, startPageStr, endPageStr, workerId] = process.argv;
    const startPage = parseInt(startPageStr, 10);
    const endPage = parseInt(endPageStr, 10);

    // --- TÍCH HỢP PROXY CHUYÊN NGHIỆP ---
    const proxyHost = process.env.PROXY_HOST;
    const proxyPort = process.env.PROXY_PORT;
    const proxyUser = process.env.PROXY_USER;
    const proxyPass = process.env.PROXY_PASS;

    const puppeteerArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--proxy-server=${proxyHost}:${proxyPort}`
    ];
    
    let browser = null;
    const allResults = [];

    try {
        console.log(`Worker ${workerId}: Bắt đầu nhiệm vụ từ trang ${startPage} đến ${endPage}`);
        browser = await puppeteer.launch({ 
            headless: true,
            args: puppeteerArgs
        });
        const page = await browser.newPage();
        
        // Xác thực proxy
        await page.authenticate({
            username: proxyUser,
            password: proxyPass
        });
        
        await page.setViewport({ width: 1920, height: 1080 });

        for (let i = startPage; i <= endPage; i++) {
            console.log(`Worker ${workerId}: Đang xử lý trang ${i}...`);
            const jobs = await scrapePage(page, keyword, i);
            if (jobs.length > 0) {
                allResults.push(...jobs);
            }
            // Không cần kiểm tra trang cuối, vì đã được phân công nhiệm vụ chính xác
            await sleep(3000); // Tạm nghỉ ngắn giữa các trang
        }

    } catch (error) {
        console.error(`Worker ${workerId}: Lỗi - ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    if (allResults.length > 0) {
        // Lưu kết quả của worker này vào một file riêng
        const outputFilename = `results_worker_${workerId}.csv`;
        const csvData = stringify(allResults, { header: true });
        fs.writeFileSync(outputFilename, '\ufeff' + csvData);
        console.log(`Worker ${workerId}: Đã lưu ${allResults.length} tin vào ${outputFilename}`);
    } else {
        console.log(`Worker ${workerId}: Không thu thập được dữ liệu nào.`);
    }
})();
