package main

import (
	"os"
	"strconv"
	"strings"
)

// Sizing from the machine, so one build suits a 1 GB box and a 64 GB server alike.
// "Memory available" = the smaller of the machine's RAM and any limit systemd (MemoryMax) put on this service.

// parseMemTotal reads MemTotal from /proc/meminfo text; bytes, 0 when not found.
func parseMemTotal(meminfo string) int64 {
	for _, line := range strings.Split(meminfo, "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		f := strings.Fields(strings.TrimPrefix(line, "MemTotal:"))
		if len(f) >= 1 {
			if n, err := strconv.ParseInt(f[0], 10, 64); err == nil && n > 0 {
				return n * 1024 // the file says kB
			}
		}
	}
	return 0
}

// parseCgroupMax reads a cgroup v2 memory.max value; 0 means "no limit" ("max") or unreadable.
func parseCgroupMax(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "max" {
		return 0
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

// cgroupPathV2 finds this process's cgroup in /proc/self/cgroup text ("0::/system.slice/x.service"), "" if not cgroup v2.
func cgroupPathV2(procSelfCgroup string) string {
	for _, line := range strings.Split(procSelfCgroup, "\n") {
		if strings.HasPrefix(line, "0::") {
			return strings.TrimSpace(strings.TrimPrefix(line, "0::"))
		}
	}
	return ""
}

// effectiveMemory: bytes this program may really use, 0 if it cannot be told.
func effectiveMemory() int64 {
	total := int64(0)
	if b, err := os.ReadFile("/proc/meminfo"); err == nil {
		total = parseMemTotal(string(b))
	}
	eff := total
	if b, err := os.ReadFile("/proc/self/cgroup"); err == nil {
		p := cgroupPathV2(string(b))
		for p != "" && p != "/" { // this cgroup and its parents: the smallest limit wins
			if m, err := os.ReadFile("/sys/fs/cgroup" + p + "/memory.max"); err == nil {
				if lim := parseCgroupMax(string(m)); lim > 0 && (eff == 0 || lim < eff) {
					eff = lim
				}
			}
			i := strings.LastIndexByte(p, '/')
			if i <= 0 {
				break
			}
			p = p[:i]
		}
	}
	return eff
}

// autoJobs: how many aggregations may run at once. About one per 200 MB, at least 1, at most 16.
// 717 MB -> 3, 1 GB -> 5, 4 GB -> 16 (capped). Unknown memory -> 4.
func autoJobs(mem int64) int {
	if mem <= 0 {
		return 4
	}
	j := int(mem >> 20 / 200)
	if j < 1 {
		return 1
	}
	if j > 16 {
		return 16
	}
	return j
}
