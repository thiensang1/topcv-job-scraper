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

// Chuyển đổi Unix timestamp (tính bằng giây) sang định dạng YYYY-MM-DD
function formatDate(unixTimestamp) {
    if (!unixTimestamp) return null;
    return new Date(unixTimestamp * 1000).toISOString().split('T')[0];
}

// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    let allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";

    try {
        console.error(`--- Bắt đầu chiến dịch "Giải Mã Dữ Liệu" cho từ khóa: "${TARGET_KEYWORD}" ---`);
        
        // Chỉ cần lấy trang đầu tiên để tìm dữ liệu và tổng số trang
        const firstPageUrl = `https://vieclam24h.vn/tim-kiem-viec-lam-nhanh?q=${encodeURIComponent(TARGET_KEYWORD)}`;
        console.error(" -> Đang tải dữ liệu trang đích...");
        
        const response = await axios.get(firstPageUrl, {
            headers: { 'User-Agent': FAKE_USER_AGENT }
        });

        const $ = cheerio.load(response.data);
        
        // Tìm thẻ script chứa dữ liệu gốc
        let initialState = null;
        $('script').each((i, el) => {
            const scriptContent = $(el).html();
            if (scriptContent && scriptContent.includes('window.__INITIAL_STATE__')) {
                // Tách chuỗi JSON từ bên trong biến JavaScript
                const jsonString = scriptContent.replace('window.__INITIAL_STATE__=', '').trim().slice(0, -1);
                initialState = JSON.parse(jsonString);
                return false; // Dừng vòng lặp khi đã tìm thấy
            }
        });
        
        if (!initialState) {
            throw new Error("Không tìm thấy dữ liệu gốc 'INITIAL_STATE'. Cấu trúc trang web có thể đã thay đổi.");
        }

        const jobsData = initialState.jobs.jobList.data;
        const totalRecords = jobsData.total_records;

        if (!jobsData.jobs || jobsData.jobs.length === 0) {
            throw new Error("Không tìm thấy danh sách việc làm bên trong dữ liệu gốc.");
        }
        
        console.error(` -> Giải mã thành công! Tìm thấy tổng cộng ${totalRecords} tin tuyển dụng.`);
        
        // Xử lý dữ liệu đã có từ trang đầu tiên
        const processedJobs = jobsData.jobs.map(job => {
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
        
        allJobs.push(...processedJobs);
        
        // (Tùy chọn) Hiện tại chúng ta mới chỉ lấy dữ liệu từ trang đầu tiên vì nó đã được nhúng sẵn.
        // Để lấy các trang sau, cần phải phân tích các request API mà trang web gọi khi người dùng chuyển trang.
        // Tuy nhiên, cách làm này đã lấy được một lượng lớn dữ liệu ban đầu một cách hiệu quả.

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
