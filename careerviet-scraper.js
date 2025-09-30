const fs = require('fs');
const axios = require('axios');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const JOBS_PER_PAGE = 50; // CareerViet API có thể trả về nhiều tin mỗi trang
const FAKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// --- API ENDPOINT ---
const API_JOB_SEARCH = "https://api.careerviet.vn/v1/jobs";

// --- HÀM HELPER ---
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function formatDate(isoString) {
    if (!isoString) return null;
    return isoString.split('T')[0];
}

// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    let allJobs = [];
    let jobsCount = 0;
    let finalFilename = "";
    let currentPage = 1;
    let totalPages = 1;

    console.error(`\n--- Bắt đầu khai thác dữ liệu CareerViet cho từ khóa: "${TARGET_KEYWORD}" ---`);

    while (currentPage <= totalPages) {
        try {
            console.error(`Đang khai thác trang ${currentPage}/${totalPages}...`);
            
            const response = await axios.get(API_JOB_SEARCH, {
                params: {
                    keyword: TARGET_KEYWORD,
                    page: currentPage,
                    limit: JOBS_PER_PAGE,
                },
                headers: {
                    'User-Agent': FAKE_USER_AGENT,
                    'Accept': 'application/json, text/plain, */*'
                }
            });

            const data = response.data?.data;
            const jobs = data?.jobs;

            if (currentPage === 1 && data?.totalPages) {
                totalPages = data.totalPages;
                console.error(`Phát hiện có tổng cộng ${data.total} tin tuyển dụng (${totalPages} trang).`);
            }

            if (!jobs || jobs.length === 0) {
                console.error("Không có dữ liệu ở trang này, dừng lại.");
                break;
            }

            const processedJobs = jobs.map(job => {
                const locationText = job.locations.map(loc => loc.city_name).join(', ');

                return {
                    'Tên công việc': job.job_title,
                    'Tên công ty': job.company_name,
                    'Nơi làm việc': locationText,
                    'Mức lương': job.salary || 'Thỏa thuận',
                    'Ngày đăng tin': formatDate(job.posted_date),
                    'Link': `https://careerviet.vn${job.job_link}`
                };
            });
            
            allJobs.push(...processedJobs);
            currentPage++;

        } catch (error) {
            let errorMessage = error.message;
            if (error.response) {
                errorMessage = `Request failed with status code ${error.response.status}`;
            }
            console.error(`Lỗi khi khai thác trang ${currentPage}: ${errorMessage}`);
            break;
        }
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
