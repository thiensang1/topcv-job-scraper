const fs = require('fs');
const axios = require('axios');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán"; // Từ khóa bạn muốn tìm
const JOBS_PER_PAGE = 100; // Số lượng tin trên mỗi request API, tối đa là 100

// --- API ENDPOINTS ---
const API_JOB_SEARCH = "https://ms.vietnamworks.com/job-search/v1.0/search";
const API_META_DATA = "https://ms.vietnamworks.com/meta/v1.0/job-levels";

// --- HÀM TIỆN ÍCH ---
function formatSalary(min, max) {
    if (min === 0 && max === 0) return "Thỏa thuận";
    if (min > 0 && max > 0) return `${min} - ${max} USD`;
    if (min > 0) return `Từ ${min} USD`;
    if (max > 0) return `Lên đến ${max} USD`;
    return "Thỏa thuận";
}

// Chuyển đổi Unix timestamp (tính bằng giây) sang định dạng YYYY-MM-DD
function formatDate(unixTimestamp) {
    if (!unixTimestamp) return null;
    return new Date(unixTimestamp * 1000).toISOString().split('T')[0];
}

// --- GIAI ĐOẠN 1: TẢI DỮ LIỆU META ---
async function fetchJobLevels() {
    console.error("-> Đang tải dữ liệu meta về cấp bậc công việc...");
    try {
        const response = await axios.get(API_META_DATA);
        const jobLevels = new Map();
        if (response.data && response.data.data) {
            response.data.data.forEach(item => {
                if (item.type === "jobLevelItem") {
                    jobLevels.set(item.id, item.name);
                }
            });
        }
        console.error("-> Tải dữ liệu meta thành công!");
        return jobLevels;
    } catch (error) {
        console.error("Lỗi khi tải dữ liệu meta:", error.message);
        return new Map(); // Trả về một map rỗng nếu có lỗi
    }
}

// --- GIAI ĐOẠN 2 & 3: KHAI THÁC, TỔNG HỢP ---
async function scrapeAllJobs(jobLevelsMap) {
    let allJobs = [];
    let currentPage = 1;
    let totalPages = 1; // Giả định ban đầu
    
    console.error(`\n--- Bắt đầu khai thác dữ liệu cho từ khóa: "${TARGET_KEYWORD}" ---`);

    while (currentPage <= totalPages) {
        try {
            console.error(`Đang khai thác trang ${currentPage}/${totalPages}...`);
            const response = await axios.get(API_JOB_SEARCH, {
                params: {
                    keyword: TARGET_KEYWORD,
                    pageSize: JOBS_PER_PAGE,
                    page: currentPage,
                }
            });

            const { jobs, total } = response.data.data;

            if (currentPage === 1) {
                // Cập nhật tổng số trang ở lần gọi đầu tiên
                totalPages = Math.ceil(total / JOBS_PER_PAGE);
                console.error(`Phát hiện có tổng cộng ${total} tin tuyển dụng (${totalPages} trang).`);
            }

            if (!jobs || jobs.length === 0) {
                console.error("Không có dữ liệu ở trang này, dừng lại.");
                break;
            }

            const processedJobs = jobs.map(job => ({
                'Tên công việc': job.jobTitle,
                'Tên công ty': job.companyName,
                'Cấp bậc': jobLevelsMap.get(job.jobLevelId) || 'Không xác định',
                'Mức lương (USD)': formatSalary(job.salaryMin, job.salaryMax),
                'Ngày đăng tin': formatDate(job.approvedOn),
                'Ngày hết hạn': formatDate(job.expiredOn),
                'Link': job.jobUrl
            }));

            allJobs.push(...processedJobs);
            currentPage++;

        } catch (error) {
            console.error(`Lỗi khi khai thác trang ${currentPage}:`, error.message);
            break; // Dừng lại nếu có lỗi
        }
    }
    return allJobs;
}

// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    const jobLevels = await fetchJobLevels();
    const allJobs = await scrapeAllJobs(jobLevels);

    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: 'Asia/Ho_Chi_Minh'
        }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        
        const finalFilename = `data/vietnamworks_${TARGET_KEYWORD.replace(/\s/g, '-')}_${timestamp}.csv`;
        
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${allJobs.length} tin việc làm từ VietnamWorks vào file ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }
})();
