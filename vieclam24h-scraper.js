const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const CHROME_PATH = process.env.CHROME_PATH;
const PROXY_SERVER = process.env.PROXY_URL;

// --- HÀM HELPER ---
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

// --- GIAI ĐOẠN 1: THU THẬP TẤT CẢ LINKS VIỆC LÀM ---
async function getAllJobLinks(browser) {
    const allLinks = new Set();
    let currentPage = 1;
    let hasNextPage = true;
    
    console.error(`--- Giai đoạn 1: Bắt đầu thu thập link việc làm cho từ khóa "${TARGET_KEYWORD}" ---`);

    while (hasNextPage) {
        let page;
        try {
            page = await browser.newPage();
            const url = `https://vieclam24h.vn/tim-kiem-viec-lam-nhanh?q=${encodeURIComponent(TARGET_KEYWORD)}&page=${currentPage}`;
            console.error(` -> Đang quét trang kết quả: ${currentPage}...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // --- THAY ĐỔI: Chờ đợi tin tuyển dụng đầu tiên xuất hiện ---
            const jobSelector = 'div.box-job-info h3.title-job a';
            console.error(' -> Đang chờ các link việc làm xuất hiện...');
            await page.waitForSelector(jobSelector, { timeout: 15000 }); // Chờ tối đa 15 giây
            
            const linksOnPage = await page.$$eval(jobSelector, anchors => anchors.map(a => a.href));
            
            if (linksOnPage.length === 0) {
                hasNextPage = false;
                console.error(" -> Không tìm thấy link nào, kết thúc giai đoạn 1.");
                break;
            }

            linksOnPage.forEach(link => allLinks.add(link));
            console.error(` -> Thu thập được ${linksOnPage.length} link. Tổng số link: ${allLinks.size}`);
            
            const nextPageButton = await page.$('a.page-link[aria-label="Next"]');
            if (!nextPageButton) {
                hasNextPage = false;
                console.error(" -> Hết trang, kết thúc giai đoạn 1.");
            } else {
                currentPage++;
            }
        } catch (error) {
            console.error(` -> Lỗi khi quét trang kết quả ${currentPage}: ${error.message}`);
            // --- THAY ĐỔI: Chụp ảnh màn hình khi có lỗi ---
            if (page) {
                await page.screenshot({ path: 'error_screenshot.png' });
                console.error(' -> Đã chụp ảnh màn hình lỗi vào file error_screenshot.png');
            }
            hasNextPage = false;
        } finally {
            if (page) await page.close();
        }
    }
    return Array.from(allLinks);
}

// --- GIAI ĐOẠN 2: KHAI THÁC DỮ LIỆU CHI TIẾT TỪ LINK ---
async function scrapeJobDetails(url, browser) {
    let page;
    try {
        page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const content = await page.content();
        const $ = cheerio.load(content);
        const title = $('h1.job-title').text().trim() || null;
        const company = $('a.company-name').text().trim() || null;
        const salary = $('span[data-id="Salary"]').text().trim() || 'Thỏa thuận';
        let location = await page.$eval('div.list-work-place-item span.text-dark-gray', el => el.innerText.trim()).catch(() => null);
        if (!location) {
            location = $('span[data-id="Location"]').text().trim() || 'Không xác định';
        }
        const postedDateText = $('span[data-id="PostedDate"]').text().trim() || null;
        return {
            'Tên công việc': title, 'Tên công ty': company, 'Nơi làm việc': location, 
            'Mức lương': salary, 'Ngày đăng tin': postedDateText, 'Link': url
        };
    } catch (error) {
        console.error(` -> Lỗi khi cào dữ liệu từ ${url}: ${error.message}`);
        return null;
    } finally {
        if (page) await page.close();
    }
}

// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    if (!CHROME_PATH) {
        throw new Error("Biến môi trường CHROME_PATH không được thiết lập.");
    }
    const launchOptions = {
        headless: true, executablePath: CHROME_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    };
    if (PROXY_SERVER) {
        console.error(`Đang sử dụng proxy: ${PROXY_SERVER}`);
        launchOptions.args.push(`--proxy-server=${PROXY_SERVER}`);
    }
    const browser = await puppeteer.launch(launchOptions);
    const allJobUrls = await getAllJobLinks(browser);
    let allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";
    if (allJobUrls.length > 0) {
        console.error(`\n--- Giai đoạn 2: Bắt đầu khai thác chi tiết ${allJobUrls.length} việc làm ---`);
        for (let i = 0; i < allJobUrls.length; i++) {
            console.error(` -> Đang khai thác link ${i + 1}/${allJobUrls.length}...`);
            const jobData = await scrapeJobDetails(allJobUrls[i], browser);
            if (jobData) allJobs.push(jobData);
        }
    }
    await browser.close();
    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        finalFilename = `data/vieclam24h_${TARGET_KEYWORD.replace(/\s/g, '-')}_${timestamp}.csv`;
        jobsCount = allJobs.length;
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${jobsCount} tin việc làm từ Vieclam24h vào file ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }
    setOutput('jobs_count', jobsCount);
    setOutput('final_filename', finalFilename);
})();
