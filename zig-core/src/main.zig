const std = @import("std");

const page = std.heap.page_allocator;
const CELL_SIZE: f64 = 0.01;
const MAX_CELLS_PER_QUERY: u64 = 10000;
const RET_BUF_SIZE: usize = 131072;

var ret_buf: [RET_BUF_SIZE]u8 = undefined;
var ret_fba = std.heap.FixedBufferAllocator.init(&ret_buf);
var last_query_len: usize = 0;

pub fn panic(msg: []const u8, _: ?*std.builtin.StackTrace, _: ?usize) noreturn {
    _ = msg;
    @trap();
}

fn cellKey(lat: f64, lng: f64) u64 {
    const lat_cell: u32 = @intFromFloat((lat + 90.0) / CELL_SIZE);
    const lng_cell: u32 = @intFromFloat((lng + 180.0) / CELL_SIZE);
    return (@as(u64, lat_cell) << 32) | @as(u64, lng_cell);
}

const PinEntry = struct {
    lat: f64,
    lng: f64,
    cell: u64,
};

const SpatialIndex = struct {
    allocator: std.mem.Allocator,
    cells: std.AutoHashMap(u64, std.ArrayList([]const u8)),
    pin_entries: std.StringHashMap(PinEntry),

    fn init(allocator: std.mem.Allocator) !SpatialIndex {
        return SpatialIndex{
            .allocator = allocator,
            .cells = std.AutoHashMap(u64, std.ArrayList([]const u8)).init(allocator),
            .pin_entries = std.StringHashMap(PinEntry).init(allocator),
        };
    }

    fn deinit(self: *SpatialIndex) void {
        var cell_iter = self.cells.iterator();
        while (cell_iter.next()) |entry| {
            for (entry.value_ptr.items) |id| {
                self.allocator.free(id);
            }
            entry.value_ptr.deinit(self.allocator);
        }
        self.cells.deinit();
        self.pin_entries.deinit();
    }

    fn insert(self: *SpatialIndex, id: []const u8, lat: f64, lng: f64) !void {
        const ck = cellKey(lat, lng);
        try self.pin_entries.put(id, .{ .lat = lat, .lng = lng, .cell = ck });
        const cell_id_dupe = try self.allocator.dupe(u8, id);
        const gop = try self.cells.getOrPut(ck);
        if (!gop.found_existing) {
            gop.value_ptr.* = .{ .items = &.{}, .capacity = 0 };
        }
        try gop.value_ptr.append(self.allocator, cell_id_dupe);
    }

    fn remove(self: *SpatialIndex, id: []const u8) bool {
        const entry = self.pin_entries.get(id) orelse return false;
        const ck = entry.cell;
        if (self.cells.getPtr(ck)) |cell_list| {
            for (cell_list.items, 0..) |stored_id, i| {
                if (std.mem.eql(u8, stored_id, id)) {
                    self.allocator.free(stored_id);
                    _ = cell_list.swapRemove(i);
                    break;
                }
            }
            if (cell_list.items.len == 0) {
                cell_list.deinit(self.allocator);
                _ = self.cells.remove(ck);
            }
        }
        _ = self.pin_entries.remove(id);
        return true;
    }

    fn clear(self: *SpatialIndex) void {
        var cell_iter = self.cells.iterator();
        while (cell_iter.next()) |entry| {
            for (entry.value_ptr.items) |id| {
                self.allocator.free(id);
            }
            entry.value_ptr.deinit(self.allocator);
        }
        self.cells.clearAndFree();
        self.pin_entries.clearAndFree();
    }

    fn queryBbox(self: *SpatialIndex, sw_lat: f64, sw_lng: f64, ne_lat: f64, ne_lng: f64) ![]const u8 {
        ret_fba.reset();
        const ra = ret_fba.allocator();

        const lat_start: u32 = @intFromFloat((sw_lat + 90.0) / CELL_SIZE);
        const lat_end: u32 = @intFromFloat((ne_lat + 90.0) / CELL_SIZE);
        const lng_start: u32 = @intFromFloat((sw_lng + 180.0) / CELL_SIZE);
        const lng_end: u32 = @intFromFloat((ne_lng + 180.0) / CELL_SIZE);

        const lat_cells: u64 = @intCast(lat_end -| lat_start + 1);
        const lng_cells: u64 = @intCast(lng_end -| lng_start + 1);
        const total_cells = lat_cells * lng_cells;
        if (total_cells > MAX_CELLS_PER_QUERY) return error.TooManyCells;
        if (total_cells == 0) return &[0]u8{};

        var seen = std.StringHashMap(void).init(ra);

        var lat: u32 = lat_start;
        while (lat <= lat_end) : (lat += 1) {
            var lng: u32 = lng_start;
            while (lng <= lng_end) : (lng += 1) {
                const ck = (@as(u64, lat) << 32) | @as(u64, lng);
                if (self.cells.get(ck)) |cell_ids| {
                    for (cell_ids.items) |id| {
                        if (!seen.contains(id)) {
                            seen.put(id, {}) catch continue;
                        }
                    }
                }
            }
        }

        var buf: std.ArrayList(u8) = .{ .items = &.{}, .capacity = 0 };
        try buf.append(ra, '[');
        var first = true;
        var iter = seen.keyIterator();
        while (iter.next()) |id| {
            if (!first) try buf.append(ra, ',');
            try buf.append(ra, '"');
            for (id.*) |c| {
                switch (c) {
                    '\\' => try buf.appendSlice(ra, "\\\\"),
                    '"' => try buf.appendSlice(ra, "\\\""),
                    else => try buf.append(ra, c),
                }
            }
            try buf.append(ra, '"');
            first = false;
        }
        try buf.append(ra, ']');

        return buf.items;
    }
};

export fn alloc(size: usize) ?[*]u8 {
    const buf = page.alloc(u8, size) catch return null;
    return buf.ptr;
}

export fn dealloc(ptr: [*]u8, size: usize) void {
    page.free(ptr[0..size]);
}

export fn spatial_new(capacity: usize) ?*SpatialIndex {
    _ = capacity;
    const idx = page.create(SpatialIndex) catch return null;
    idx.* = SpatialIndex.init(page) catch {
        page.destroy(idx);
        return null;
    };
    return idx;
}

export fn spatial_free(idx: *SpatialIndex) void {
    idx.deinit();
    page.destroy(idx);
}

export fn spatial_insert(idx: *SpatialIndex, id_ptr: [*]const u8, id_len: usize, lat: f64, lng: f64) void {
    const id = id_ptr[0..id_len];
    idx.insert(id, lat, lng) catch return;
}

export fn spatial_remove(idx: *SpatialIndex, id_ptr: [*]const u8, id_len: usize) i32 {
    const id = id_ptr[0..id_len];
    return if (idx.remove(id)) @as(i32, 1) else @as(i32, 0);
}

export fn spatial_query_bbox(idx: *SpatialIndex, sw_lat: f64, sw_lng: f64, ne_lat: f64, ne_lng: f64) ?[*]u8 {
    const result = idx.queryBbox(sw_lat, sw_lng, ne_lat, ne_lng) catch {
        last_query_len = 0;
        return null;
    };
    last_query_len = result.len;
    return @constCast(result.ptr);
}

export fn spatial_query_len() usize {
    return last_query_len;
}

export fn spatial_clear(idx: *SpatialIndex) void {
    idx.clear();
}
