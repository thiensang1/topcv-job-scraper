const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const CHROME_PATH = process.env.CHROME_PATH;
const PROXY_SERVER = process.env.PROXY_URL; // Hỗ trợ proxy tĩnh nếu có

// --- HÀM HELPER ---
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function formatSalary(min, max, unit) {
    if (min === 0 && max === 0) return "Thỏa thuận";
    const format = (num) => new Intl.NumberFormat('vi-VN').format(num);
    const currency = (unit || 'vnd').toUpperCase();
    if (min > 0 && max > 0) return `${format(min)} - ${format(max)} ${currency}`;
    if (min > 0) return `Từ ${format(min)} ${currency}`;
    if (max > 0) return `Lên đến ${format(max)} ${currency}`;
    return "Thỏa thuận";
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

    let allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";

    try {
        console.error(`--- Bắt đầu chiến dịch "Điệp Viên Bắt Sóng" cho từ khóa: "${TARGET_KEYWORD}" ---`);

        // Thiết lập "máy bắt sóng" trước khi truy cập trang
        await page.setRequestInterception(true);
        page.on('request', request => request.continue());
        
        const apiResponsePromise = page.waitForResponse(response => 
            response.url().includes('careerviet.vn/search-jobs') && response.request().method() === 'POST'
        );

        const searchUrl = `https://careerviet.vn/tim-viec-lam/${TARGET_KEYWORD.replace(/\s/g, '-')}.html`;
        console.error(" -> Đang truy cập trang đích để kích hoạt API...");
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        console.error(" -> Đang chờ 'bắt sóng' API...");
        const apiResponse = await apiResponsePromise;
        const jsonData = await apiResponse.json();

        const jobs = jsonData?.data;

        if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
            throw new Error("Đã bắt được sóng API nhưng không có dữ liệu việc làm.");
        }

        console.error(` -> Bắt sóng thành công! Tìm thấy ${jobs.length} tin tuyển dụng.`);
        
        allJobs = jobs.map(job => {
            return {
                'Tên công việc': job.JOB_TITLE,
                'Tên công ty': job.EMP_NAME,
                'Nơi làm việc': job.LOCATION_NAME_ARR.join(', '),
                'Mức lương': job.JOB_SALARY_STRING || formatSalary(job.JOB_FROMSALARY_CVR, job.JOB_TOSALARY_CVR, job.JOB_SALARYUNIT_CVR),
                'Ngày đăng tin': job.JOB_ACTIVEDATE,
                'Ngày hết hạn': job.JOB_LASTDATE,
                'Link': job.LINK_JOB
            };
        });

    } catch (error) {
        console.error(`Lỗi nghiêm trọng trong chiến dịch: ${error.message}`);
        try {
            await page.screenshot({ path: 'error_screenshot_careerviet.png' });
            console.error(' -> Đã chụp ảnh màn hình lỗi vào file error_screenshot_careerviet.png');
        } catch (screenshotError) {
            console.error(' -> Không thể chụp ảnh màn hình:', screenshotError.message);
        }
    } finally {
        if (browser) await browser.close();
    }

    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        finalFilename = `data/careerviet_${TARGET_KEYWORD.replace(/\s/g, '-')}_${timestamp}.csv`;
        jobsCount = allJobs.length;
        
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${jobsCount} tin việc làm từ CareerViet vào file ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }

    setOutput('jobs_count', jobsCount);
    setOutput('final_filename', finalFilename);
})();
