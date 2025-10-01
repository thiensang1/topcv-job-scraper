const fs = require('fs');
const axios = require('axios');
const axiosRetry = require('axios-retry');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const JOBS_PER_PAGE = 30; // Số lượng tin trên mỗi request
const MAX_PAGES = 100; // Giới hạn số trang để tránh vòng lặp vô hạn
const FAKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// --- API ENDPOINT ---
const API_JOB_SEARCH = "https://careerviet.vn/search-jobs";

// --- CẤU HÌNH RETRY CHO AXIOS ---
axiosRetry(axios, {
    retries: 3,
    retryDelay: (retryCount) => retryCount * 1000, // Chờ 1s, 2s, 3s
    retryCondition: (error) => error.response?.status === 429
});

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
    let page = 1;
    const jobIds = new Set(); // Lưu trữ JOB_ID để kiểm tra trùng lặp

    try {
        console.error(`--- Bắt đầu khai thác dữ liệu CareerViet cho từ khóa: "${TARGET_KEYWORD}" ---`);

        while (page <= MAX_PAGES) {
            console.error(` -> Đang lấy dữ liệu trang ${page}...`);
            const response = await axios.post(
                API_JOB_SEARCH,
                {
                    keyword: TARGET_KEYWORD,
                    page: page,
                    size: JOBS_PER_PAGE
                },
                {
                    headers: {
                        'User-Agent': FAKE_USER_AGENT,
                        'Content-Type': 'application/json'
                    },
                    proxy: process.env.PROXY_URL ? {
                        host: new URL(process.env.PROXY_URL).hostname,
                        port: new URL(process.env.PROXY_URL).port || 80,
                        protocol: new URL(process.env.PROXY_URL).protocol.replace(':', '')
                    } : false
                }
            );

            const jobs = response.data?.data;

            if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
                console.error(` -> Không còn dữ liệu ở trang ${page}. Kết thúc phân trang.`);
                break;
            }

            console.error(` -> Phân tích thành công trang ${page}! Tìm thấy ${jobs.length} tin tuyển dụng.`);

            const newJobs = jobs
                .filter(job => {
                    // Lọc job có JOB_TITLE chứa TARGET_KEYWORD
                    const isRelevant = job.JOB_TITLE?.toLowerCase().includes(TARGET_KEYWORD.toLowerCase());
                    // Kiểm tra trùng lặp JOB_ID
                    if (!isRelevant || jobIds.has(job.JOB_ID)) return false;
                    jobIds.add(job.JOB_ID);
                    return true;
                })
                .map(job => ({
                    'Tên công việc': job.JOB_TITLE || 'N/A',
                    'Tên công ty': job.EMP_NAME || 'N/A',
                    'Nơi làm việc': job.LOCATION_NAME_ARR?.join(', ') || 'N/A',
                    'Mức lương': job.JOB_SALARY_STRING || 'N/A',
                    'Ngày đăng tin': job.JOB_ACTIVEDATE || 'N/A',
                    'Ngày hết hạn': job.JOB_LASTDATE || 'N/A',
                    'Link': job.LINK_JOB || 'N/A'
                }));

            allJobs = [...allJobs, ...newJobs];
            page++;
        }

    } catch (error) {
        let errorMessage = error.message;
        if (error.response) {
            errorMessage = `Request failed with status code ${error.response.status}: ${JSON.stringify(error.response.data)}`;
        } else if (error.request) {
            errorMessage = 'No response received from server';
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
