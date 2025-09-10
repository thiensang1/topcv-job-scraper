// --- PHIÊN BẢN SCRAPER CUỐI CÙNG: TÍCH HỢP HÀM CHUYỂN ĐỔI NGÀY THÁNG ---

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');

puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.random() * (max - min) + min;

// --- "VŨ KHÍ" MỚI: "PHIÊN DỊCH VIÊN" THÔNG THÁI (Từ bạn) ---
/**
 * Chuyển đổi chuỗi thời gian tương đối (ví dụ: "2 ngày trước") thành định dạng YYYY-MM-DD.
 * @param {string} timeString - Chuỗi thời gian đầu vào.
 * @returns {string|null} Ngày tháng ở định dạng YYYY-MM-DD hoặc null.
 */
function convertPostTimeToDate(timeString) {
    if (!timeString) return null;
    const now = new Date();
    // Giả định múi giờ Việt Nam cho các tính toán
    now.setHours(now.getHours() + 7);

    const normalizedString = timeString.toLowerCase().trim();

    if (normalizedString.includes('hôm qua')) {
        now.setDate(now.getDate() - 1);
    } else if (normalizedString.includes('hôm kia')) {
        now.setDate(now.getDate() - 2);
    } else if (normalizedString.includes('ngày trước')) {
        const daysMatch = normalizedString.match(/\d+/);
        if (daysMatch) {
            const days = parseInt(daysMatch[0], 10);
            if (!isNaN(days)) now.setDate(now.getDate() - days);
        }
    } else if (normalizedString.includes('tuần trước')) {
        const weeksMatch = normalizedString.match(/\d+/);
        if (weeksMatch) {
            const weeks = parseInt(weeksMatch[0], 10);
            if (!isNaN(weeks)) now.setDate(now.getDate() - (weeks * 7));
        }
    } else if (normalizedString.includes('tháng trước')) {
        const monthsMatch = normalizedString.match(/\d+/);
        if (monthsMatch) {
            const months = parseInt(monthsMatch[0], 10);
            if (!isNaN(months)) now.setMonth(now.getMonth() - months);
        }
    } else if (normalizedString.includes('năm trước')) {
        const yearsMatch = normalizedString.match(/\d+/);
        if (yearsMatch) {
            const years = parseInt(yearsMatch[0], 10);
            if (!isNaN(years)) now.setFullYear(now.getFullYear() - years);
        }
    } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(normalizedString)) {
        const parts = normalizedString.split('-');
        if (parts.length === 3) {
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
    }
    return now.toISOString().split('T')[0];
}


async function scrapeTopCVByKeyword(driver, keyword, page) {
    const base_url = "https://www.topcv.vn";
    let targetUrl;

    if (keyword === 'ke-toan') {
        targetUrl = `${base_url}/tim-viec-lam-ke-toan-cr392cb393?type_keyword=1&page=${page}&category_family=r392~b393`;
    } else {
        targetUrl = `${base_url}/tim-viec-lam-${keyword}?type_keyword=1&page=${page}&sba=1`;
    }
    
    console.log(`   -> Đang truy cập trang '${keyword}' trang ${page}...`);
    await driver.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    
    try {
        console.log("   -> Chờ danh sách việc làm (bộ khung) được tải...");
        const jobListSelector = 'div.job-list-search-result';
        await driver.waitForSelector(jobListSelector, { timeout: 30000 });
        console.log("   -> Bộ khung đã xuất hiện.");

        console.log("   -> Bắt đầu giai đoạn 'quan sát kiên nhẫn' để chờ trang ổn định...");
        let previousHtml = '';
        let currentHtml = '';
        let stabilityCounter = 0;
        const requiredStableChecks = 2;

        for (let i = 0; i < 10; i++) {
            currentHtml = await driver.$eval(jobListSelector, element => element.innerHTML);
            if (currentHtml.replace(/\s/g, '') === previousHtml.replace(/\s/g, '') && currentHtml.length > 0) {
                stabilityCounter++;
                console.log(`   -> Trang đã ổn định (lần ${stabilityCounter}/${requiredStableChecks})...`);
                if (stabilityCounter >= requiredStableChecks) break;
            } else {
                stabilityCounter = 0;
            }
            previousHtml = currentHtml;
            await sleep(2000);
        }
        
        if (stabilityCounter < requiredStableChecks) {
            throw new Error("Trang không ổn định sau một thời gian chờ, có thể đã bị chặn.");
        }
        
        console.log("   -> Trang đã ổn định. Dữ liệu chi tiết đã được tải.");

        console.log("   -> Mô phỏng hành vi cuộn trang...");
        await driver.evaluate(() => { window.scrollBy(0, document.body.scrollHeight / 2); });
        await sleep(randomDelay(500, 1000));
        await driver.evaluate(() => { window.scrollBy(0, document.body.scrollHeight); });
        await sleep(randomDelay(500, 1000));

        console.log("   -> Bắt đầu trích xuất dữ liệu...");
        const content = await driver.content();
        const $ = cheerio.load(content);

        const jobListings = $('div[class*="job-item"]');
        if (jobListings.length === 0) {
            console.log("   -> Không tìm thấy tin tuyển dụng nào trên trang này.");
            return { jobs: [], isLastPage: true }; 
        }

        const processedJobs = [];
        jobListings.each((index, element) => {
            const titleTag = $(element).find('h3[class*="title"] a');
            const salaryTag = $(element).find('span[class*="salary"]');
            const locationTag = $(element).find('.city-text');
            const companyLogoTag = $(element).find('img.w-100.lazy');
            const dateContainerTag = $(element).find('span.hidden-on-quick-view');
            const expTag = $(element).find('.exp');
            
            let companyText = null;
            if (companyLogoTag.length) {
                companyText = companyLogoTag.attr('alt');
                if(companyText) companyText = companyText.trim();
            }

            let dateText = null;
            if (dateContainerTag.length) {
                const nextNode = dateContainerTag[0].nextSibling;
                if (nextNode && nextNode.type === 'text') {
                    dateText = nextNode.data.trim();
                }
            }
            
            let expText = null;
            if (expTag.length) {
                expText = expTag.text().trim();
            }
            
            // --- TÍCH HỢP LOGIC MỚI ---
            const convertedDate = convertPostTimeToDate(dateText);

            processedJobs.push({
                'keyword': keyword,
                'title': titleTag.text().trim() || null,
                'link': titleTag.attr('href') ? `${base_url}${titleTag.attr('href')}` : null,
                'company': companyText,
                'salary': salaryTag.text().trim() || 'Thỏa thuận',
                'Nơi làm việc': locationTag.text().trim() || null,
                'thời gian đăng': convertedDate, // <-- SỬ DỤNG NGÀY ĐÃ ĐƯỢC CHUYỂN ĐỔI
                'Kinh nghiệm làm việc tối thiểu': expText,
            });
        });
        
        let isLastPage = false;
        const lastPaginationItem = $('ul.pagination li:last-child');
        if (lastPaginationItem.hasClass('disabled')) {
            isLastPage = true;
        }

        return { jobs: processedJobs, isLastPage: isLastPage };

    } catch (error) {
        console.error(`   -> Lỗi khi xử lý trang ${page} cho từ khóa '${keyword}': ${error.message}`);
        return null;
    }
}


(async () => {
    const TARGET_KEYWORDS = ["ke-toan"];
    const PAGES_PER_KEYWORD = 200;
    let allResults = [];

    console.log("Đang khởi tạo trình duyệt Puppeteer Stealth...");
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        for (const keyword of TARGET_KEYWORDS) {
             for (let i = 1; i <= PAGES_PER_KEYWORD; i++) {
                const result = await scrapeTopCVByKeyword(page, keyword, i);
                
                if (result === null) {
                    console.log(`   -> Chuyển sang từ khóa tiếp theo do có lỗi.`);
                    break; 
                }
                
                const { jobs, isLastPage } = result;

                if (jobs.length > 0) {
                    allResults.push(...jobs);
                    console.log(`   -> Đã thu thập ${jobs.length} tin tuyển dụng.`);
                }
                
                if (isLastPage) {
                    console.log(`   -> Đã đến trang cuối cùng cho từ khóa '${keyword}'.`);
                    break;
                }
                
                 const delay = randomDelay(10000, 20000);
                 console.log(`   -> Tạm nghỉ ${(delay/1000).toFixed(2)} giây...`);
                 await sleep(delay);
             }
            console.log(`=== Hoàn thành thu thập cho từ khóa '${keyword}'. Tổng số tin đã thu thập: ${allResults.length} ===`);
        }
    } catch (error) {
        console.error(`Lỗi không xác định: ${error.message}`);
    } finally {
        await browser.close();
        console.log("\nĐã đóng trình duyệt an toàn.");
    }

    if (allResults.length > 0) {
        console.log("\n--- BÁO CÁO TỔNG HỢP CUỐI CÙNG (TOPCV) ---");
        const totalJobs = allResults.length;
        const uniqueCompanies = new Set(allResults.map(job => job.company).filter(c => c)).size;
        console.log(`Tổng số tin tuyển dụng đã thu thập từ tất cả các từ khóa: ${totalJobs}`);
        console.log(`Số lượng công ty khác nhau: ${uniqueCompanies}`);
        
        const outputFilename = "topcv_targeted_jobs_final.csv";
        const csvData = stringify(allResults, { header: true });
        fs.writeFileSync(outputFilename, '\ufeff' + csvData);
        console.log(`\nĐã lưu toàn bộ dữ liệu thành công vào file: ${outputFilename}`);
    } else {
        console.log("\nKhông thu thập được dữ liệu nào.");
    }
})();

