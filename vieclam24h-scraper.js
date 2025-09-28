const fs = require('fs');
const axios = require('axios');
const { stringify } = require('csv-stringify/sync');

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "kế toán";
const JOBS_PER_PAGE = 30;

// --- API ENDPOINT ---
const API_JOB_SEARCH = "https://apiv2.vieclam24h.vn/employer/fe/job/get-job-list";

// --- HÀM TIỆN ÍCH ---
function formatSalary(salary) {
    if (!salary) return "Thỏa thuận";
    return salary;
}

function formatDate(isoString) {
    if (!isoString) return null;
    return isoString.split(' ')[0];
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
            const response = await axios.get(API_JOB_SEARCH, {
                params: {
                    q: TARGET_KEYWORD,
                    page: currentPage,
                    per_page: JOBS_PER_PAGE,
                    sort_q: 'priority_max,desc',
                    request_from: 'search_result_web',
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
                // --- PHẦN CẬP NHẬT LOGIC LẤY NƠI LÀM VIỆC ---
                let locationText = 'Không xác định';
                try {
                    // 1. Kiểm tra xem job.places có phải là một chuỗi hợp lệ không
                    if (job.places && typeof job.places === 'string') {
                        // 2. Dùng JSON.parse() để chuyển chuỗi thành mảng
                        const locationsArray = JSON.parse(job.places);

                        // 3. Kiểm tra kết quả và lấy dữ liệu
                        if (Array.isArray(locationsArray) && locationsArray.length > 0) {
                            // Lặp qua mảng, lấy ra thuộc tính 'address' và nối chúng lại
                            locationText = locationsArray.map(loc => loc.address).join('; ');
                        }
                    }
                } catch (e) {
                    console.error('Lỗi khi phân tích cú pháp (parsing) dữ liệu địa điểm:', e.message);
                    // Giữ nguyên giá trị mặc định nếu có lỗi
                }
                // --- KẾT THÚC CẬP NHẬT ---

                return {
                    'Tên công việc': job.job_title,
                    'Tên công ty': job.company_name,
                    'Nơi làm việc': locationText, // Sử dụng địa chỉ đã được xử lý
                    'Mức lương': formatSalary(job.salary_text),
                    'Ngày đăng tin': formatDate(job.updated_at),
                    'Link': job.online_url
                };
            });

            allJobs.push(...processedJobs);
            currentPage++;

        } catch (error) {
            console.error(`Lỗi khi khai thác trang ${currentPage}:`, error.message);
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
