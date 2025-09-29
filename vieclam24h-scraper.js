const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');

puppeteer.use(StealthPlugin());

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
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatDate(unixTimestamp) {
    if (!unixTimestamp) return null;
    return new Date(unixTimestamp * 1000).toISOString().split('T')[0];
}

// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    if (!CHROME_PATH) {
        throw new Error("Biến môi trường CHROME_PATH không được thiết lập.");
    }
    
    const launchOptions = {
        headless: 'new',
        executablePath: CHROME_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    };
    if (PROXY_SERVER) {
        console.error(`Đang sử dụng proxy: ${PROXY_SERVER}`);
        launchOptions.args.push(`--proxy-server=${PROXY_SERVER}`);
    }

    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    let allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";

    try {
        // --- GIAI ĐOẠN "KHỞI ĐỘNG" ---
        console.error("\n--- [Điệp viên] Bắt đầu giai đoạn Khởi Động (Warm-up)... ---");
        await page.goto('https://vieclam24h.vn/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.error(" -> Đã truy cập trang chủ, đang chờ...");
        await sleep(3000);
        await page.mouse.move(Math.random() * 500 + 100, Math.random() * 500 + 100);
        console.error("--- Khởi động hoàn tất, bắt đầu nhiệm vụ chính. ---\n");

        console.error(`--- Bắt đầu chiến dịch "Khai Quật Dữ Liệu" cho từ khóa: "${TARGET_KEYWORD}" ---`);
        
        const searchUrl = `https://vieclam24h.vn/tim-kiem-viec-lam-nhanh?q=${encodeURIComponent(TARGET_KEYWORD)}`;
        console.error(" -> Đang tải dữ liệu trang đích bằng trình duyệt tàng hình...");
        
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const content = await page.content();
        
        const $ = cheerio.load(content);
        
        let initialState = null;
        $('script').each((i, el) => {
            const scriptContent = $(el).html();
            if (scriptContent && scriptContent.includes('window.__INITIAL_STATE__')) {
                const jsonString = scriptContent.replace('window.__INITIAL_STATE__=', '').trim().slice(0, -1);
                initialState = JSON.parse(jsonString);
                return false;
            }
        });
        
        if (!initialState) {
            throw new Error("Không tìm thấy dữ liệu gốc 'INITIAL_STATE'.");
        }

        const jobsData = initialState.jobs.jobList.data;
        const jobs = jobsData?.jobs;

        if (!jobs || jobs.length === 0) {
            throw new Error("Không tìm thấy danh sách việc làm bên trong dữ liệu gốc.");
        }
        
        console.error(` -> Giải mã thành công! Tìm thấy ${jobs.length} tin.`);
        
        allJobs = jobs.map(job => {
            let locationText = 'Không xác định';
            try {
                if (job.places && typeof job.places === 'string') {
                    const locationsArray = JSON.parse(job.places);
                    if (Array.isArray(locationsArray) && locationsArray.length > 0) {
                        locationText = locationsArray.map(loc => loc.address).join('; ');
                    }
                }
            } catch (e) { /* Bỏ qua lỗi parsing */ }

            return {
                'Tên công việc': job.title,
                'Tên công ty': job.employer_info.name,
                'Nơi làm việc': locationText,
                'Mức lương': job.salary_text || 'Thỏa thuận',
                'Ngày đăng tin': formatDate(job.approved_at),
                'Link': `https://vieclam24h.vn${job.alias_url}`
            };
        });
        
    } catch (error) {
        console.error(`Lỗi nghiêm trọng trong chiến dịch: ${error.message}`);
        await page.screenshot({ path: 'error_screenshot.png' });
        console.error(' -> Đã chụp ảnh màn hình lỗi vào file error_screenshot.png');
    } finally {
        if(browser) await browser.close();
    }

    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho-Chi-Minh' }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
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
