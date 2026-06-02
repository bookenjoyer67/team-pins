const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{
        .default_target = .{
            .cpu_arch = .wasm32,
            .os_tag = .freestanding,
        },
    });

    const optimize: std.builtin.OptimizeMode = if (b.option(bool, "release", "optimize for end users") orelse false)
        .ReleaseSmall
    else
        .Debug;

    const mod = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .strip = true,
    });

    const lib = b.addExecutable(.{
        .name = "spatial",
        .root_module = mod,
    });
    lib.entry = .disabled;
    lib.rdynamic = true;

    b.installArtifact(lib);
}
