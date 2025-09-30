const fs = require('fs');
const axios = require('axios');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const JOBS_PER_PAGE = 30; // Số lượng tin trên mỗi request
const FAKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// --- API ENDPOINT ---
const API_JOB_SEARCH = "https://careerviet.vn/search-jobs";

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
        console.error(`--- Bắt đầu khai thác dữ liệu CareerViet cho từ khóa: "${TARGET_KEYWORD}" ---`);

        // Gửi yêu cầu POST với payload
        const response = await axios.post(
            API_JOB_SEARCH,
            // Request Body (Payload)
            {
                keyword: TARGET_KEYWORD,
                page: 1, // Bắt đầu từ trang 1
                size: JOBS_PER_PAGE
            },
            // Request Config
            {
                headers: {
                    'User-Agent': FAKE_USER_AGENT,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        // Đọc dữ liệu từ cấu trúc bạn đã cung cấp
        const jobs = response.data?.data;

        if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
            throw new Error("API không trả về dữ liệu việc làm hoặc dữ liệu rỗng.");
        }

        console.error(` -> Phân tích thành công! Tìm thấy ${jobs.length} tin tuyển dụng.`);
        
        // --- SỬA LỖI: Đọc đúng các key viết hoa từ API ---
        allJobs = jobs.map(job => {
            return {
                'Tên công việc': job.JOB_TITLE,
                'Tên công ty': job.EMP_NAME,
                'Nơi làm việc': job.LOCATION_NAME_ARR.join(', '),
                'Mức lương': job.JOB_SALARY_STRING,
                'Ngày đăng tin': job.JOB_ACTIVEDATE,
                'Ngày hết hạn': job.JOB_LASTDATE,
                'Link': job.LINK_JOB
            };
        });
        // --- KẾT THÚC SỬA LỖI ---

    } catch (error) {
        let errorMessage = error.message;
        if (error.response) {
            errorMessage = `Request failed with status code ${error.response.status}`;
        }
        console.error(`Lỗi nghiêm trọng trong chiến dịch: ${errorMessage}`);
    }

    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: 'Asia/Ho_Chi_Minh'
        }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        
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
