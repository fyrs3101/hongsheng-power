/*
 * 鸿升中学 · 智能电源管理 —— WebView2 静态加载器 GNU 工具链兼容层
 *
 * 背景：webview2-com-sys 自带的 WebView2LoaderStatic.lib 由 MSVC 编译，
 * 静态链接到 GNU 工具链（x86_64-pc-windows-gnu）交叉编译出的 exe 时，
 * 会缺少以下 MSVC CRT 内部符号。本文件用 C 提供等价实现，
 * 使免安装版 exe 真正单文件运行，无需随附 WebView2Loader.dll。
 *
 * 缺失符号清单：
 *   __security_cookie / __security_check_cookie   (/GS 栈保护)
 *   _Init_thread_epoch / _Init_thread_header / _Init_thread_footer
 *                                                  (C++11 thread-safe static)
 *   std::operator new(size_t, nothrow_t const&) / operator delete(void*, size_t)
 *   std::nothrow
 */

#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>

/* ---------- /GS 栈保护 ---------- */
uint64_t __security_cookie = 0x00002B992DDFA232ULL;

void __security_check_cookie(uint64_t cookie)
{
    if (cookie != __security_cookie) {
        /* 与 MSVC __report_gsfailure 行为一致：立即终止 */
        __builtin_trap();
    }
}

void __report_gsfailure(void)
{
    __builtin_trap();
}

/* ---------- MSVC C++11 thread-safe static 初始化协议 ----------
 * guard 状态编码：0 = 未初始化，1 = 正在初始化，-1 = 已完成
 * _Init_thread_header 返回值：-1 = 本线程应执行初始化，
 *                            0 = 已完成，1 = 他线程正在初始化（需等待）
 * 本程序不会并发初始化这些静态变量，简化实现保证功能正确。
 */
int32_t _Init_thread_epoch = 0;

int32_t _Init_thread_header(int32_t *guard)
{
    if (*guard == -1) {
        return 0;
    }
    if (*guard == 1) {
        return 1;
    }
    *guard = 1;
    return -1;
}

void _Init_thread_footer(int32_t *guard)
{
    *guard = -1;
    _Init_thread_epoch++;
}

/* ---------- C++ operator new / delete（编译后经 objcopy 重命名为 MSVC 名称修饰） ---------- */
void *wv2_new_nothrow(size_t n)
{
    return malloc(n);
}

void wv2_delete_sized(void *p, size_t n)
{
    (void)n;
    free(p);
}

/* ---------- std::nothrow 常量对象 ---------- */
static char wv2_nothrow_storage[16];
void *wv2_nothrow_obj = wv2_nothrow_storage;
