/*
 * AFLDB-ISSUE-320 (ISSUE-316 successor gate): enforced native-library closure for the guarded
 * rehearsal/rebuild runtime. A glibc rtld-audit module (LD_AUDIT), loaded into every guarded
 * process before the program's own code runs.
 *
 * Policy (AFLDB_NATIVE_POLICY, pinned by AFLDB_NATIVE_POLICY_SHA256; written by the launcher from a
 * verified runtime record):
 *     afldb-native-closure-policy 1
 *     auditor <sha256> <canonical path>
 *     object <sha256> <canonical path>       (sorted, unique; executables and shared objects)
 *
 * What it enforces, in every process that carries it:
 *   - la_version: the policy bytes equal their pin; this module's own file is the bound auditor;
 *     LD_AUDIT names exactly this module; LD_PRELOAD and LD_LIBRARY_PATH are absent.
 *   - la_objsearch: every existing loader search candidate must be a bound object (no ambient
 *     search path is trusted); an existing unbound candidate refuses instead of being skipped.
 *   - la_objopen: the main executable (/proc/self/exe), the dynamic loader and every DT_NEEDED or
 *     dlopen()ed object must be bound, its file bytes must equal the bound sha256, and the inode the
 *     process actually mapped must be the inode that was hashed.
 *   - la_preinit: every executable file mapping in /proc/self/maps (including this module's own
 *     namespace) is a bound, hash-verified object.
 *   - exec family / posix_spawn / system / popen (via la_symbind): the target executable must be a
 *     bound object BEFORE exec (this covers static children such as esbuild, which never load an
 *     auditor), and the child's environment is forced to carry this module and its pinned policy, so
 *     an explicit environment cannot drop enforcement. system/popen refuse unless the process
 *     environment still carries it.
 * A refusal writes "AFLDB native closure REFUSED: ..." to stderr and exits 127 (load-time), or fails
 * the exec with EACCES (exec-time). There is no override.
 *
 * Threat model (stated in issues.md, AFLDB-ISSUE-320): drift, substitution or addition of native code
 * in the guarded process tree by anything without the ability to rewrite a bound file concurrently
 * between verification and mapping, ptrace a guarded process, or run as root. vDSO and JIT code are
 * not files and are out of scope. Built with AFLDB_NATIVE_RECORD it only RECORDS (derivation aid for
 * a disposable root); that build is never bound by a runtime record.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <elf.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <link.h>
#include <spawn.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/auxv.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/sysmacros.h>
#include <unistd.h>

#define MAX_OBJECTS 4096
#define MAX_ENV 8192
#define MAX_ARGS 4096

/* ------------------------------------------------------------------ sha256 (FIPS 180-4) */
typedef struct { uint32_t h[8]; uint64_t len; unsigned char buf[64]; size_t n; } sha_ctx;
static const uint32_t K[64] = {
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
#define ROR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))
static void sha_block(sha_ctx *c, const unsigned char *p) {
  uint32_t w[64], a, b, d, e, f, g, h, cc, t1, t2;
  for (int i = 0; i < 16; i++) w[i] = (uint32_t)p[4*i] << 24 | (uint32_t)p[4*i+1] << 16 | (uint32_t)p[4*i+2] << 8 | p[4*i+3];
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = ROR(w[i-15], 7) ^ ROR(w[i-15], 18) ^ (w[i-15] >> 3);
    uint32_t s1 = ROR(w[i-2], 17) ^ ROR(w[i-2], 19) ^ (w[i-2] >> 10);
    w[i] = w[i-16] + s0 + w[i-7] + s1;
  }
  a = c->h[0]; b = c->h[1]; cc = c->h[2]; d = c->h[3]; e = c->h[4]; f = c->h[5]; g = c->h[6]; h = c->h[7];
  for (int i = 0; i < 64; i++) {
    t1 = h + (ROR(e, 6) ^ ROR(e, 11) ^ ROR(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
    t2 = (ROR(a, 2) ^ ROR(a, 13) ^ ROR(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc));
    h = g; g = f; f = e; e = d + t1; d = cc; cc = b; b = a; a = t1 + t2;
  }
  c->h[0] += a; c->h[1] += b; c->h[2] += cc; c->h[3] += d; c->h[4] += e; c->h[5] += f; c->h[6] += g; c->h[7] += h;
}
static void sha_init(sha_ctx *c) {
  static const uint32_t iv[8] = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
  memcpy(c->h, iv, sizeof iv); c->len = 0; c->n = 0;
}
static void sha_update(sha_ctx *c, const unsigned char *p, size_t len) {
  c->len += len;
  while (len) {
    size_t take = 64 - c->n < len ? 64 - c->n : len;
    memcpy(c->buf + c->n, p, take); c->n += take; p += take; len -= take;
    if (c->n == 64) { sha_block(c, c->buf); c->n = 0; }
  }
}
static void sha_hex(sha_ctx *c, char out[65]) {
  uint64_t bits = c->len * 8;
  unsigned char pad = 0x80, zero = 0, lenb[8];
  sha_update(c, &pad, 1);
  while (c->n != 56) sha_update(c, &zero, 1);
  for (int i = 0; i < 8; i++) lenb[i] = (unsigned char)(bits >> (56 - 8 * i));
  sha_update(c, lenb, 8);
  for (int i = 0; i < 8; i++) snprintf(out + 8 * i, 9, "%08x", c->h[i]);
  out[64] = 0;
}
/* Hash an open file descriptor from offset 0 (pread: the fd's position is untouched). */
static int sha_fd(int fd, char out[65]) {
  sha_ctx c; unsigned char buf[65536]; off_t off = 0; ssize_t r;
  sha_init(&c);
  while ((r = pread(fd, buf, sizeof buf, off)) > 0) { sha_update(&c, buf, (size_t)r); off += r; }
  if (r < 0) return -1;
  sha_hex(&c, out);
  return 0;
}

/* ------------------------------------------------------------------ state */
typedef struct { char sha[65]; char *path; } object_t;
static object_t g_objects[MAX_OBJECTS];
static size_t g_count;
static char g_auditor_sha[65], *g_auditor_path;
static char g_env_audit[PATH_MAX + 16], g_env_policy[PATH_MAX + 32], g_env_pin[128];
static struct link_map *g_base_libc, *g_base_main;
/* Verified (dev, inode, size, mtime, ctime) -> object index, written only under the loader lock. */
typedef struct { dev_t dev; ino_t ino; off_t size; struct timespec mtime, ctime; } seen_t;
static seen_t g_seen[MAX_OBJECTS];
static size_t g_seen_count;
static int g_active;

static void say(const char *a, const char *b, const char *c) {
  char line[PATH_MAX * 2 + 256];
  int n = snprintf(line, sizeof line, "AFLDB native closure %s%s%s\n", a, b ? b : "", c ? c : "");
  if (n > 0) { ssize_t ignored = write(2, line, (size_t)(n < (int)sizeof line ? n : (int)sizeof line - 1)); (void)ignored; }
}
static void __attribute__((noreturn)) refuse(const char *what, const char *path) {
  say("REFUSED: ", what, path);
  _exit(127);
}

static const object_t *lookup(const char *path) {
  size_t lo = 0, hi = g_count;
  while (lo < hi) {
    size_t mid = (lo + hi) / 2;
    int c = strcmp(g_objects[mid].path, path);
    if (!c) return &g_objects[mid];
    if (c < 0) lo = mid + 1; else hi = mid;
  }
  return NULL;
}

#ifdef AFLDB_NATIVE_RECORD
static void record_object(const char *kind, const char *path) {
  int fd = open(path, O_RDONLY | O_CLOEXEC); char hex[65] = "unreadable";
  if (fd >= 0) { if (sha_fd(fd, hex)) strcpy(hex, "unreadable"); close(fd); }
  const char *log = getenv("AFLDB_NATIVE_RECORD_LOG");
  if (!log) return;
  int out = open(log, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0600);
  if (out < 0) return;
  char line[PATH_MAX + 160];
  int n = snprintf(line, sizeof line, "%d %s %s %s\n", (int)getpid(), kind, hex, path);
  if (n > 0) { ssize_t ignored = write(out, line, (size_t)n); (void)ignored; }
  close(out);
}
#endif

/* Verify one canonical path: bound, regular, bytes equal, and (when `need_mapped`) the inode the
 * process mapped under that name is the inode hashed. Returns 0, or refuses. */
static int verify_mapped(const char *path, dev_t dev, ino_t ino);
static void verify_path(const char *path, int need_mapped) {
#ifdef AFLDB_NATIVE_RECORD
  record_object(need_mapped ? "mapped" : "exec", path);
  return;
#endif
  const object_t *o = lookup(path);
  if (!o) refuse("unbound native object: ", path);
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) refuse("bound object unreadable: ", path);
  struct stat st;
  if (fstat(fd, &st) || !S_ISREG(st.st_mode) || (st.st_mode & (S_ISUID | S_ISGID))) { close(fd); refuse("bound object is not a plain regular file: ", path); }
  int known = 0;
  for (size_t i = 0; i < g_seen_count; i++) {
    seen_t *s = &g_seen[i];
    if (s->dev == st.st_dev && s->ino == st.st_ino && s->size == st.st_size
        && s->mtime.tv_sec == st.st_mtim.tv_sec && s->mtime.tv_nsec == st.st_mtim.tv_nsec
        && s->ctime.tv_sec == st.st_ctim.tv_sec && s->ctime.tv_nsec == st.st_ctim.tv_nsec) { known = 1; break; }
  }
  if (!known) {
    char hex[65];
    if (sha_fd(fd, hex)) { close(fd); refuse("bound object unreadable: ", path); }
    if (strcmp(hex, o->sha)) { close(fd); refuse("native object bytes differ from the bound sha256: ", path); }
    if (g_seen_count < MAX_OBJECTS && g_active) {
      seen_t *s = &g_seen[g_seen_count++];
      s->dev = st.st_dev; s->ino = st.st_ino; s->size = st.st_size; s->mtime = st.st_mtim; s->ctime = st.st_ctim;
    }
  }
  close(fd);
  if (need_mapped && verify_mapped(path, st.st_dev, st.st_ino)) refuse("mapped inode is not the verified file: ", path);
}

/* /proc/self/maps: every mapping named `path` must carry (dev, ino); at least one must exist. */
static int verify_mapped(const char *path, dev_t dev, ino_t ino) {
  int fd = open("/proc/self/maps", O_RDONLY | O_CLOEXEC);
  if (fd < 0) return -1;
  char buf[65536], line[PATH_MAX + 256]; size_t ln = 0; ssize_t r; int found = 0, bad = 0;
  size_t plen = strlen(path);
  while ((r = read(fd, buf, sizeof buf)) > 0) {
    for (ssize_t i = 0; i < r; i++) {
      if (buf[i] != '\n') { if (ln < sizeof line - 1) line[ln++] = buf[i]; continue; }
      line[ln] = 0; ln = 0;
      char *name = strchr(line, '/');
      if (!name || strlen(name) != plen || strcmp(name, path)) continue;
      unsigned long long lo, hi, off, inode; unsigned maj, min; char perms[8];
      if (sscanf(line, "%llx-%llx %7s %llx %x:%x %llu", &lo, &hi, perms, &off, &maj, &min, &inode) != 7) { bad = 1; continue; }
      if (makedev(maj, min) != dev || (ino_t)inode != ino) bad = 1; else found = 1;
    }
  }
  close(fd);
  return (found && !bad) ? 0 : -1;
}

/* Every executable file mapping in this process must be a bound, verified object. Record builds log
 * them instead (derivation aid only). */
static void verify_all_mappings(void) {
  int fd = open("/proc/self/maps", O_RDONLY | O_CLOEXEC);
  if (fd < 0) refuse("cannot read /proc/self/maps", NULL);
  char buf[65536], line[PATH_MAX + 256]; size_t ln = 0; ssize_t r;
  static unsigned char done[MAX_OBJECTS];
  while ((r = read(fd, buf, sizeof buf)) > 0) {
    for (ssize_t i = 0; i < r; i++) {
      if (buf[i] != '\n') { if (ln < sizeof line - 1) line[ln++] = buf[i]; continue; }
      line[ln] = 0; ln = 0;
      char perms[8] = ""; char *name = strchr(line, '/');
      if (sscanf(line, "%*x-%*x %7s", perms) != 1 || perms[2] != 'x') continue;
      if (!name) {
        if (strchr(line, '[')) continue; /* kernel-named pseudo mappings: [vdso], [vsyscall], [uprobes] */
        refuse("anonymous executable mapping before main", NULL);
      }
      if (strstr(name, " (deleted)")) refuse("executable mapping of a deleted file: ", name);
#ifdef AFLDB_NATIVE_RECORD
      record_object("maps", name);
#else
      const object_t *o = lookup(name);
      if (!o) refuse("unbound executable mapping: ", name);
      if (!done[o - g_objects]) { verify_path(name, 1); done[o - g_objects] = 1; }
#endif
    }
  }
  close(fd);
}

/* ------------------------------------------------------------------ policy */
static void load_policy(void) {
  const char *pp = getenv("AFLDB_NATIVE_POLICY"), *pin = getenv("AFLDB_NATIVE_POLICY_SHA256"), *audit = getenv("LD_AUDIT");
  if (!pp || !pin || pp[0] != '/' || strlen(pin) != 64) refuse("policy location or pin missing", NULL);
  const char *preload = getenv("LD_PRELOAD"), *libpath = getenv("LD_LIBRARY_PATH");
  if ((preload && *preload) || (libpath && *libpath)) refuse("LD_PRELOAD / LD_LIBRARY_PATH present", NULL);
  int fd = open(pp, O_RDONLY | O_CLOEXEC);
  if (fd < 0) refuse("policy unreadable: ", pp);
  struct stat st;
  if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > (64 << 20)) refuse("policy is not a plain file: ", pp);
  char *text = malloc((size_t)st.st_size + 1);
  if (!text) refuse("out of memory", NULL);
  size_t got = 0;
  while (got < (size_t)st.st_size) {
    ssize_t r = pread(fd, text + got, (size_t)st.st_size - got, (off_t)got);
    if (r <= 0) refuse("policy short read: ", pp);
    got += (size_t)r;
  }
  close(fd);
  text[got] = 0;
  if (text[got - 1] != '\n' || strstr(text, "\n\n") || strchr(text, '\r') || strlen(text) != got) refuse("policy framing", NULL);
  sha_ctx c; char hex[65];
  sha_init(&c); sha_update(&c, (unsigned char *)text, got); sha_hex(&c, hex);
  if (strcmp(hex, pin)) refuse("policy bytes differ from their pin: ", pp);
  /* Parse: header, one auditor line, then sorted unique object lines. Any deviation refuses. */
  char *save = NULL, *line = strtok_r(text, "\n", &save);
  if (!line || strcmp(line, "afldb-native-closure-policy 1")) refuse("policy header", NULL);
  int have_auditor = 0;
  while ((line = strtok_r(NULL, "\n", &save))) {
    char *sp1 = strchr(line, ' '); if (!sp1) refuse("policy line", NULL);
    char *sp2 = strchr(sp1 + 1, ' '); if (!sp2 || sp2 - sp1 - 1 != 64 || sp2[1] != '/') refuse("policy line", NULL);
    *sp1 = 0; *sp2 = 0;
    for (char *h = sp1 + 1; *h; h++) if (!((*h >= '0' && *h <= '9') || (*h >= 'a' && *h <= 'f'))) refuse("policy digest", NULL);
    if (!strcmp(line, "auditor")) {
      if (have_auditor) refuse("policy auditor line repeated", NULL);
      have_auditor = 1; memcpy(g_auditor_sha, sp1 + 1, 65); g_auditor_path = sp2 + 1;
    } else if (!strcmp(line, "object")) {
      if (g_count >= MAX_OBJECTS) refuse("policy too large", NULL);
      if (g_count && strcmp(g_objects[g_count - 1].path, sp2 + 1) >= 0) refuse("policy objects unsorted or repeated", NULL);
      memcpy(g_objects[g_count].sha, sp1 + 1, 65); g_objects[g_count].path = sp2 + 1; g_count++;
    } else refuse("policy line kind", NULL);
  }
  if (!have_auditor || !g_count) refuse("policy incomplete", NULL);
  if (!audit || strcmp(audit, g_auditor_path)) refuse("LD_AUDIT is not exactly the bound auditor", NULL);
  /* This module is the bound auditor, by location and bytes. */
  Dl_info info;
  char self[PATH_MAX];
  if (!dladdr((void *)&load_policy, &info) || !info.dli_fname || !realpath(info.dli_fname, self) || strcmp(self, g_auditor_path))
    refuse("auditor location is not the bound auditor", NULL);
  int afd = open(self, O_RDONLY | O_CLOEXEC);
  if (afd < 0 || sha_fd(afd, hex) || strcmp(hex, g_auditor_sha)) refuse("auditor bytes differ from the bound sha256: ", self);
  close(afd);
  if (!lookup(g_auditor_path)) refuse("auditor is not a bound object", NULL);
  snprintf(g_env_audit, sizeof g_env_audit, "LD_AUDIT=%s", audit);
  snprintf(g_env_policy, sizeof g_env_policy, "AFLDB_NATIVE_POLICY=%s", pp);
  snprintf(g_env_pin, sizeof g_env_pin, "AFLDB_NATIVE_POLICY_SHA256=%s", pin);
}

/* ------------------------------------------------------------------ rtld-audit entry points */
unsigned int la_version(unsigned int version) {
#ifdef AFLDB_NATIVE_RECORD
  (void)version; return LAV_CURRENT;
#else
  if (version < 1) return 0;
  load_policy();
  g_active = 1;
  return version < LAV_CURRENT ? version : LAV_CURRENT;
#endif
}

char *la_objsearch(const char *name, uintptr_t *cookie, unsigned int flag) {
  (void)cookie;
  if (flag == LA_SER_ORIG && !strchr(name, '/')) return (char *)name; /* a bare name: let the search run */
  struct stat st;
  if (lstat(name, &st)) return (char *)name; /* nonexistent candidate: the loader cannot open it either */
  char real[PATH_MAX];
  if (!realpath(name, real)) refuse("search candidate cannot be resolved: ", name);
#ifdef AFLDB_NATIVE_RECORD
  record_object("candidate", real); return (char *)name;
#else
  if (!lookup(real)) refuse("unbound loader search candidate: ", name);
  return (char *)name;
#endif
}

unsigned int la_objopen(struct link_map *map, Lmid_t lmid, uintptr_t *cookie) {
  (void)cookie;
  const char *name = map->l_name;
  char real[PATH_MAX];
  if (!name || !*name) {
    ssize_t n = readlink("/proc/self/exe", real, sizeof real - 1);
    if (n <= 0) refuse("main executable unresolvable", NULL);
    real[n] = 0;
    if (strstr(real, " (deleted)")) refuse("main executable deleted: ", real);
    verify_path(real, 1);
    if (lmid == LM_ID_BASE) g_base_main = map;
  } else if (!strchr(name, '/')) {
    if (strcmp(name, "linux-vdso.so.1") || !getauxval(AT_SYSINFO_EHDR)) refuse("unbound pathless object: ", name);
  } else {
    if (!realpath(name, real)) refuse("object path unresolvable: ", name);
    verify_path(real, 1);
    const char *base = strrchr(real, '/') + 1;
    if (lmid == LM_ID_BASE && !strncmp(base, "libc.so.6", 9)) g_base_libc = map;
  }
  return LA_FLG_BINDTO | LA_FLG_BINDFROM;
}

void la_preinit(uintptr_t *cookie) {
  (void)cookie;
  verify_all_mappings();
}

/* ------------------------------------------------------------------ base-namespace symbol lookup */
static void *gnu_lookup(struct link_map *m, const char *name) {
  if (!m) return NULL;
  ElfW(Sym) *symtab = NULL; const char *strtab = NULL; const uint32_t *gh = NULL;
  for (ElfW(Dyn) *d = m->l_ld; d->d_tag != DT_NULL; d++) {
    uintptr_t v = d->d_un.d_ptr;
    if (v < m->l_addr) v += m->l_addr;
    if (d->d_tag == DT_SYMTAB) symtab = (void *)v;
    else if (d->d_tag == DT_STRTAB) strtab = (const char *)v;
    else if (d->d_tag == DT_GNU_HASH) gh = (const uint32_t *)v;
  }
  if (!symtab || !strtab || !gh) return NULL;
  uint32_t nbuckets = gh[0], symoffset = gh[1], bloom_size = gh[2];
  const ElfW(Addr) *bloom = (const ElfW(Addr) *)&gh[4];
  const uint32_t *buckets = (const uint32_t *)&bloom[bloom_size], *chain = &buckets[nbuckets];
  uint32_t h = 5381;
  for (const unsigned char *p = (const unsigned char *)name; *p; p++) h = h * 33 + *p;
  uint32_t i = buckets[h % nbuckets];
  if (i < symoffset) return NULL;
  for (;; i++) {
    uint32_t ch = chain[i - symoffset];
    if ((h | 1) == (ch | 1)) {
      ElfW(Sym) *s = &symtab[i];
      if (!strcmp(strtab + s->st_name, name) && s->st_shndx != SHN_UNDEF) return (void *)(m->l_addr + s->st_value);
    }
    if (ch & 1) return NULL;
  }
}
/* The live environment pointer. An executable that references `environ` carries a COPY relocation
 * of `__environ`, and libc reaches it through its GOT, so the global lookup order applies: the main
 * executable's definition first, libc's own storage only when the executable has none. */
static char **base_environ(void) {
  char ***p = gnu_lookup(g_base_main, "__environ");
  if (!p) p = gnu_lookup(g_base_libc, "__environ");
  return p ? *p : NULL;
}

/* ------------------------------------------------------------------ exec interposition */
/* This module runs against its own namespace's libc, whose errno is not the caller's. Every failure
 * is reported through the BASE libc's errno location, which is what the interposed caller reads. */
static int fail(int e) {
  static int *(*loc)(void);
  if (!loc) loc = (int *(*)(void))gnu_lookup(g_base_libc, "__errno_location");
  if (loc) *loc() = e;
  errno = e;
  return -1;
}
static int exec_refused(const char *what, const char *path) {
  say("REFUSED exec: ", what, path);
  return fail(EACCES);
}
/* The target must be a bound object whose bytes equal the bound sha256 (checked here, in the
 * caller, because a static executable never loads an auditor). No allocation: this may run in a
 * vfork/fork child. */
static int check_target(const char *path, int fd) {
  char real[PATH_MAX], hex[65];
  if (fd >= 0) {
    char link[64]; snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
    if (!realpath(link, real)) return exec_refused("descriptor target unresolvable", NULL);
  } else if (!realpath(path, real)) return fail(errno ? errno : ENOENT);
  const object_t *o = lookup(real);
  if (!o) return exec_refused("unbound executable: ", real);
  int f = fd >= 0 ? fd : open(real, O_RDONLY | O_CLOEXEC);
  if (f < 0) return exec_refused("bound executable unreadable: ", real);
  struct stat st;
  if (fstat(f, &st) || !S_ISREG(st.st_mode) || (st.st_mode & (S_ISUID | S_ISGID))) { if (fd < 0) close(f); return exec_refused("executable is not a plain regular file: ", real); }
  int bad = sha_fd(f, hex) || strcmp(hex, o->sha);
  if (fd < 0) close(f);
  if (bad) return exec_refused("executable bytes differ from the bound sha256: ", real);
  return 0;
}
static int is_ours(const char *e) {
  return !strncmp(e, "LD_AUDIT=", 9) || !strncmp(e, "AFLDB_NATIVE_POLICY=", 20) || !strncmp(e, "AFLDB_NATIVE_POLICY_SHA256=", 27);
}
/* The child environment: the caller's, with this module and its pinned policy forced in. */
static int child_env(char *const in[], char **out) {
  size_t n = 0;
  if (in) for (size_t i = 0; in[i]; i++) {
    if (is_ours(in[i])) continue;
    if (n >= MAX_ENV - 4) return fail(E2BIG);
    out[n++] = in[i];
  }
  out[n++] = g_env_audit; out[n++] = g_env_policy; out[n++] = g_env_pin; out[n] = NULL;
  return 0;
}
static int env_carries_ours(char **env) {
  int a = 0, p = 0, s = 0;
  for (size_t i = 0; env && env[i]; i++) {
    if (!strcmp(env[i], g_env_audit)) a = 1;
    else if (!strcmp(env[i], g_env_policy)) p = 1;
    else if (!strcmp(env[i], g_env_pin)) s = 1;
    else if (!strncmp(env[i], "LD_PRELOAD=", 11) || !strncmp(env[i], "LD_LIBRARY_PATH=", 16)) return 0;
  }
  return a && p && s;
}
/* PATH search for the p-variants, from the process environment, as libc does. */
static int search_path(const char *file, char *out) {
  if (strchr(file, '/')) { snprintf(out, PATH_MAX, "%s", file); return 0; }
  const char *path = NULL;
  char **env = base_environ();
  for (size_t i = 0; env && env[i]; i++) if (!strncmp(env[i], "PATH=", 5)) { path = env[i] + 5; break; }
  if (!path) path = "/bin:/usr/bin";
  for (const char *p = path;;) {
    const char *end = strchr(p, ':'); size_t len = end ? (size_t)(end - p) : strlen(p);
    snprintf(out, PATH_MAX, "%.*s%s%s", (int)len, len ? p : ".", "/", file);
    if (!access(out, X_OK)) return 0;
    if (!end) break;
    p = end + 1;
  }
  return fail(ENOENT);
}

static int w_execve(const char *path, char *const argv[], char *const envp[]) {
  char *env[MAX_ENV];
  if (check_target(path, -1) || child_env(envp, env)) return -1;
  syscall(SYS_execve, path, argv, env);
  return fail(errno);
}
static int w_execv(const char *path, char *const argv[]) { return w_execve(path, argv, base_environ()); }
static int w_execvpe(const char *file, char *const argv[], char *const envp[]) {
  char resolved[PATH_MAX];
  if (search_path(file, resolved)) return -1;
  return w_execve(resolved, argv, envp);
}
static int w_execvp(const char *file, char *const argv[]) { return w_execvpe(file, argv, base_environ()); }
#define COLLECT(first) \
  char *argv[MAX_ARGS]; size_t n = 0; va_list ap; argv[n++] = (char *)(first); va_start(ap, first); \
  while (n < MAX_ARGS && (argv[n++] = va_arg(ap, char *)) != NULL) {} \
  if (n >= MAX_ARGS && argv[MAX_ARGS - 1]) { va_end(ap); return fail(E2BIG); }
static int w_execl(const char *path, const char *arg, ...) { COLLECT(arg); va_end(ap); return w_execv(path, argv); }
static int w_execlp(const char *file, const char *arg, ...) { COLLECT(arg); va_end(ap); return w_execvp(file, argv); }
static int w_execle(const char *path, const char *arg, ...) {
  COLLECT(arg); char *const *envp = va_arg(ap, char *const *); va_end(ap); return w_execve(path, argv, envp);
}
static int w_fexecve(int fd, char *const argv[], char *const envp[]) {
  char *env[MAX_ENV];
  if (check_target(NULL, fd) || child_env(envp, env)) return -1;
  syscall(SYS_execveat, fd, "", argv, env, AT_EMPTY_PATH);
  return fail(errno);
}
static int w_execveat(int dirfd, const char *path, char *const argv[], char *const envp[], int flags) {
  char *env[MAX_ENV], joined[PATH_MAX];
  if ((flags & AT_EMPTY_PATH) && (!path || !*path)) { if (check_target(NULL, dirfd)) return -1; }
  else if (path && path[0] == '/') { if (check_target(path, -1)) return -1; }
  else if (dirfd == AT_FDCWD) { if (check_target(path, -1)) return -1; }
  else {
    snprintf(joined, sizeof joined, "/proc/self/fd/%d/%s", dirfd, path ? path : "");
    if (check_target(joined, -1)) return -1;
  }
  if (child_env(envp, env)) return -1;
  syscall(SYS_execveat, dirfd, path, argv, env, flags);
  return fail(errno);
}
static int w_posix_spawn(pid_t *pid, const char *path, const posix_spawn_file_actions_t *fa,
                         const posix_spawnattr_t *attr, char *const argv[], char *const envp[]) {
  char *env[MAX_ENV];
  if (check_target(path, -1)) return errno;
  if (child_env(envp ? envp : base_environ(), env)) return errno;
  /* This namespace's posix_spawn: same glibc build, so the caller's file-action/attr objects match. */
  return posix_spawn(pid, path, fa, attr, argv, env);
}
static int w_posix_spawnp(pid_t *pid, const char *file, const posix_spawn_file_actions_t *fa,
                          const posix_spawnattr_t *attr, char *const argv[], char *const envp[]) {
  char resolved[PATH_MAX];
  if (search_path(file, resolved)) return errno;
  return w_posix_spawn(pid, resolved, fa, attr, argv, envp);
}
static int (*real_system)(const char *);
static FILE *(*real_popen)(const char *, const char *);
static int shell_allowed(void) {
  if (!env_carries_ours(base_environ())) { exec_refused("system/popen without the enforced environment", NULL); return 0; }
  if (check_target("/bin/sh", -1)) return 0;
  return 1;
}
static int w_system(const char *cmd) {
  if (!cmd) return real_system ? real_system(cmd) : 0;
  if (!shell_allowed() || !real_system) return fail(EACCES);
  return real_system(cmd);
}
static FILE *w_popen(const char *cmd, const char *type) {
  if (!shell_allowed() || !real_popen) { fail(EACCES); return NULL; }
  return real_popen(cmd, type);
}

uintptr_t la_symbind64(Elf64_Sym *sym, unsigned int ndx, uintptr_t *refcook, uintptr_t *defcook,
                       unsigned int *flags, const char *symname) {
  (void)ndx; (void)refcook; (void)defcook; (void)flags;
#ifdef AFLDB_NATIVE_RECORD
  return sym->st_value;
#else
  static const struct { const char *name; void *wrapper; } table[] = {
    {"execve", (void *)w_execve}, {"execv", (void *)w_execv}, {"execvp", (void *)w_execvp},
    {"execvpe", (void *)w_execvpe}, {"execl", (void *)w_execl}, {"execlp", (void *)w_execlp},
    {"execle", (void *)w_execle}, {"fexecve", (void *)w_fexecve}, {"execveat", (void *)w_execveat},
    {"posix_spawn", (void *)w_posix_spawn}, {"posix_spawnp", (void *)w_posix_spawnp},
    {"system", (void *)w_system}, {"popen", (void *)w_popen},
  };
  if (!symname || (symname[0] != 'e' && symname[0] != 'f' && symname[0] != 'p' && symname[0] != 's')) return sym->st_value;
  for (size_t i = 0; i < sizeof table / sizeof table[0]; i++) {
    if (strcmp(symname, table[i].name)) continue;
    if (!strcmp(symname, "system")) real_system = (int (*)(const char *))sym->st_value;
    if (!strcmp(symname, "popen")) real_popen = (FILE *(*)(const char *, const char *))sym->st_value;
    return (uintptr_t)table[i].wrapper;
  }
  return sym->st_value;
#endif
}
