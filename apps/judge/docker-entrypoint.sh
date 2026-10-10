#!/bin/sh
# Prepares a cgroup v2 subtree for isolate (it expects to own /sys/fs/cgroup/isolate), then starts the
# given command. Needs --privileged (or a delegated cgroup). If cgroups are unavailable the worker can
# still run with JUDGE_CGROUPS=false, which falls back to rlimits (weaker memory accounting).
set -e

if [ "${JUDGE_CGROUPS:-false}" = "true" ] && [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  # cgroup v2's "no internal processes" rule: move this container's processes out of the root first
  mkdir -p /sys/fs/cgroup/init
  for pid in $(cat /sys/fs/cgroup/cgroup.procs); do
    echo "$pid" > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
  done
  echo "+cpu +memory +pids +cpuset" > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
  mkdir -p /sys/fs/cgroup/isolate
  echo "+cpu +memory +pids +cpuset" > /sys/fs/cgroup/isolate/cgroup.subtree_control 2>/dev/null || true
fi

exec "$@"
