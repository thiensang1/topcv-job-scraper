const fs = require('fs');
const axios = require('axios');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const JOBS_PER_PAGE = 30;
// --- BỔ SUNG 1: Thêm User-Agent giả mạo ---
const FAKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// --- API ENDPOINT ---
const API_JOB_SEARCH = "https://apiv2.vieclam24h.vn/employer/fe/job/get-job-list";
const API_META_DATA = "https://ms.vietnamworks.com/meta/v1.0/job-levels"; // Giữ lại API meta của VNW nếu cần

// --- HÀM TIỆN ÍCH ---
function formatSalary(salary) {
    if (!salary) return "Thỏa thuận";
    return salary;
}

function formatDate(isoString) {
    if (!isoString) return null;
    return isoString.split(' ')[0];
}

// --- GIAI ĐOẠN 1: TẢI DỮ LIỆU META (Nếu cần, hiện tại script Vieclam24h không dùng) ---
// Giữ lại hàm này phòng trường hợp sau này cần nối thêm dữ liệu
async function fetchJobLevels() {
    return new Map(); // Trả về Map rỗng vì không dùng đến
}

// --- HÀM CHÍNH ĐIỀU KHIỂN ---
(async () => {
    let allJobs = [];
    let currentPage = 1;
    let totalPages = 1;

    console.error(`\n--- Bắt đầu khai thác dữ liệu Vieclam24h cho từ khóa: "${TARGET_KEYWORD}" ---`);

    while (currentPage <= totalPages) {
        try {
            console.error(`Đang khai thác trang ${currentPage}/${totalPages}...`);

            // --- BỔ SUNG 2: Thêm headers vào yêu cầu API ---
            const response = await axios.get(API_JOB_SEARCH, {
                params: {
                    q: TARGET_KEYWORD,
                    page: currentPage,
                    per_page: JOBS_PER_PAGE,
                    sort_q: 'priority_max,desc',
                    request_from: 'search_result_web',
                },
                headers: {
                    'User-Agent': FAKE_USER_AGENT
                }
            });

            const jobs = response.data?.data?.jobs;
            const pagination = response.data?.data?.pagination;

            if (currentPage === 1 && pagination?.total_pages) {
                totalPages = pagination.total_pages;
                console.error(`Phát hiện có tổng cộng ${pagination.total_records} tin tuyển dụng (${totalPages} trang).`);
            }

            if (!jobs || jobs.length === 0) {
                console.error("Không có dữ liệu ở trang này, dừng lại.");
                break;
            }

            const processedJobs = jobs.map(job => {
                let locationText = 'Không xác định';
                try {
                    if (job.places && typeof job.places === 'string') {
                        const locationsArray = JSON.parse(job.places);
                        if (Array.isArray(locationsArray) && locationsArray.length > 0) {
                            locationText = locationsArray.map(loc => loc.address).join('; ');
                        }
                    }
                } catch (e) {
                    // Bỏ qua lỗi parsing
                }

                return {
                    'Tên công việc': job.job_title,
                    'Tên công ty': job.company_name,
                    'Nơi làm việc': locationText,
                    'Mức lương': formatSalary(job.salary_text),
                    'Ngày đăng tin': formatDate(job.updated_at),
                    'Link': job.online_url
                };
            });

            allJobs.push(...processedJobs);
            currentPage++;

        } catch (error) {
            if (error.response && error.response.status === 403) {
                 console.error(`Lỗi 403 Forbidden khi khai thác trang ${currentPage}. Yêu cầu bị từ chối. Script sẽ dừng lại.`);
            } else {
                console.error(`Lỗi khi khai thác trang ${currentPage}:`, error.message);
            }
            break;
        }
    }
    
    if (allJobs.length > 0) {
        const timestamp = new Date().toLocaleString('vi-VN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: 'Asia/Ho_Chi_Minh'
        }).replace(/, /g, '_').replace(/\//g, '-').replace(/:/g, '-');
        
        const finalFilename = `data/vieclam24h_${TARGET_KEYWORD.replace(/\s/g, '-')}_${timestamp}.csv`;
        
        fs.mkdirSync('data', { recursive: true });
        fs.writeFileSync(finalFilename, '\ufeff' + stringify(allJobs, { header: true }));
        
        console.error(`\n--- BÁO CÁO NHIỆM VỤ ---`);
        console.error(`Đã tổng hợp ${allJobs.length} tin việc làm từ Vieclam24h vào file ${finalFilename}`);
    } else {
        console.error('\nKhông có dữ liệu mới để tổng hợp.');
    }
})();
