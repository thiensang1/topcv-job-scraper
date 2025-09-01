// --- CHUYÊN GIA TỔNG HỢP ---
// Nhiệm vụ: Gom tất cả các kết quả từ các worker, chống trùng lặp và tạo ra file cuối cùng.

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

// Hàm chính
function combineAndCommit() {
    const artifactsDir = './raw-results';
    const allJobs = new Map(); // Dùng Map để chống trùng lặp dựa trên link

    // Kiểm tra xem thư mục chứa kết quả có tồn tại không
    if (fs.existsSync(artifactsDir)) {
        const workerDirs = fs.readdirSync(artifactsDir);
        console.log(`Đang xử lý kết quả từ ${workerDirs.length} worker...`);

        // Lặp qua từng thư mục của mỗi worker
        for (const dir of workerDirs) {
            try {
                const files = fs.readdirSync(path.join(artifactsDir, dir));
                // Lặp qua từng file trong thư mục của worker
                for (const file of files) {
                    if (file.endsWith('.csv')) {
                        try {
                            const content = fs.readFileSync(path.join(artifactsDir, dir, file), 'utf-8');
                            // Đọc và phân tích file CSV
                            const records = parse(content, { columns: true, skip_empty_lines: true });
                            records.forEach(record => {
                                // Dùng link làm key duy nhất để tự động loại bỏ các tin trùng lặp
                                if (record.link) {
                                    allJobs.set(record.link, record);
                                }
                            });
                        } catch (e) {
                            console.log(`-> Cảnh báo: Bỏ qua file lỗi hoặc trống: ${file}. Lỗi: ${e.message}`);
                        }
                    }
                }
            } catch (e) {
                console.log(`-> Cảnh báo: Bỏ qua thư mục lỗi: ${dir}. Lỗi: ${e.message}`);
            }
        }
    }

    // Kiểm tra xem có thu thập được dữ liệu nào không
    if (allJobs.size > 0) {
        const finalData = Array.from(allJobs.values());
        
        // Tạo tên file theo ngày tháng năm hiện tại (giờ Việt Nam)
        const date = new Date().toLocaleDateString('vi-VN', {
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit', 
            timeZone: 'Asia/Ho_Chi_Minh'
        }).replace(/\//g, '-');

        const finalFilename = `data/topcv_ketoan_${date}.csv`;
        
        // Tạo thư mục 'data' nếu nó chưa tồn tại
        fs.mkdirSync('data', { recursive: true });

        // Chuyển đổi dữ liệu sang định dạng CSV và lưu file
        const finalCsv = stringify(finalData, { header: true });
        fs.writeFileSync(finalFilename, '\ufeff' + finalCsv); // Thêm BOM để Excel đọc đúng tiếng Việt
        
        console.log(`--- TỔNG HỢP HOÀN TẤT ---`);
        console.log(`Đã tổng hợp ${finalData.length} tin tuyển dụng duy nhất vào file: ${finalFilename}`);
        
        // Xuất ra output để các bước sau trong GitHub Actions có thể sử dụng
        // Cú pháp '>> $GITHUB_OUTPUT' là cách mới và an toàn để set output
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `final_filename=${finalFilename}\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `jobs_count=${finalData.length}\n`);

    } else {
        console.log('--- TỔNG HỢP ---');
        console.log('Không có dữ liệu mới để tổng hợp.');
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'jobs_count=0\n');
    }
}

// Chạy hàm chính
combineAndCommit();
