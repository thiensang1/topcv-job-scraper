const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const FAKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// --- HÀM HELPER ---
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    let allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";

    try {
        console.error(`--- Bắt đầu chiến dịch "Vụ Cướp Dữ Liệu" cho từ khóa: "${TARGET_KEYWORD}" ---`);
        const searchUrl = `https://vieclam24h.vn/tim-kiem-viec-lam-nhanh?q=${encodeURIComponent(TARGET_KEYWORD)}`;
        
        console.error(" -> Đang tải dữ liệu trang đích...");
        const response = await axios.get(searchUrl, {
            headers: { 'User-Agent': FAKE_USER_AGENT }
        });

        const $ = cheerio.load(response.data);
        const nextDataScript = $('#__NEXT_DATA__').html();
        
        if (!nextDataScript) {
            throw new Error("Không tìm thấy kho báu '__NEXT_DATA__'. Cấu trúc trang web có thể đã thay đổi.");
        }

        const jsonData = JSON.parse(nextDataScript);
        
        // Đường dẫn đến danh sách việc làm và thông tin phân trang có thể thay đổi, cần kiểm tra nếu có lỗi
        const jobs = jsonData?.props?.pageProps?.data?.data?.jobs;
        const totalPages = jsonData?.props?.pageProps?.data?.data?.pagination?.total_pages;

        if (!jobs || jobs.length === 0) {
            throw new Error("Không tìm thấy danh sách việc làm bên trong '__NEXT_DATA__'.");
        }
        
        console.error(` -> Phân tích thành công! Tìm thấy ${jobs.length} tin trên trang đầu tiên. Tổng số trang: ${totalPages}`);
        
        // Xử lý dữ liệu đã có
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
                'Tên công việc': job.job_title,
                'Tên công ty': job.company_name,
                'Nơi làm việc': locationText,
                'Mức lương': job.salary_text || 'Thỏa thuận',
                'Ngày đăng tin': job.updated_at ? job.updated_at.split(' ')[0] : null,
                'Link': job.online_url
            };
        });
        
        // (Tùy chọn) Nếu muốn lấy tất cả các trang, bạn có thể thêm một vòng lặp ở đây
        // Tuy nhiên, cách làm này đã lấy được toàn bộ dữ liệu trang 1 một cách hiệu quả

    } catch (error) {
        console.error(`Lỗi nghiêm trọng trong chiến dịch: ${error.message}`);
    }

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
