const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const context = {};
vm.runInNewContext(fs.readFileSync(process.env.GEOM || path.join(__dirname, '../app_src/doubleBubbleGeometry.js'), 'utf8'), context);
const geometry = context.TypeRDoubleBubble;

// The visible outline is the union of two disks. Their exact intersections
// provide independent ground truth, including unequal bodies and oblique joins.
function outline(leftRadius, rightRadius, distance, samples) {
    const x = (distance * distance + leftRadius * leftRadius - rightRadius * rightRadius) / (2 * distance);
    const y = Math.sqrt(leftRadius * leftRadius - x * x);
    const leftAngle = Math.atan2(y, x), rightAngle = Math.atan2(y, x - distance), points = [];
    for (let i = 0; i <= samples; i++) {
        const angle = leftAngle + (2 * Math.PI - 2 * leftAngle) * i / samples;
        points.push([leftRadius * Math.cos(angle), leftRadius * Math.sin(angle)]);
    }
    for (let i = 1; i < samples; i++) {
        const angle = -rightAngle + 2 * rightAngle * i / samples;
        points.push([distance + rightRadius * Math.cos(angle), rightRadius * Math.sin(angle)]);
    }
    return { points, x, y };
}

let cases = 0;
for (const [leftRadius, rightRadius, distance] of [[150, 150, 225], [200, 100, 240], [100, 200, 240], [200, 80, 250]]) {
    for (const [rotation, scale, stretch, shear, samples, reverse] of [
        [0, 1, 1, 0, 96, false], [.31, .75, 1, 0, 192, true],
        [Math.PI / 2, 3, 1, 0, 128, false], [2.33, 1, 1.4, .35, 192, true],
    ]) {
        const shape = outline(leftRadius, rightRadius, distance, samples), cos = Math.cos(rotation), sin = Math.sin(rotation);
        const transform = ([x, y]) => {
            const u = scale * (stretch * x + shear * y), v = scale * y;
            return [420 + cos * u - sin * v, 570 + sin * u + cos * v];
        };
        const originalX = point => {
            const u = ((point[0] - 420) * cos + (point[1] - 570) * sin) / scale;
            const v = (-(point[0] - 420) * sin + (point[1] - 570) * cos) / scale;
            return (u - shear * v) / stretch;
        };
        const polygon = shape.points.map(transform);
        if (reverse) polygon.reverse();
        const regions = geometry.detect([polygon]);
        const label = `${leftRadius}/${rightRadius}, rotation=${rotation}, shear=${shear}`;
        assert.equal(regions.length, 2, label + ': exactly two bodies');
        const seed = point => { const p = transform(point); return { x: p[0], y: p[1] }; };
        const left = geometry.choose(regions, seed([0, 0])), right = geometry.choose(regions, seed([distance, 0]));
        assert.notStrictEqual(left, right, label + ': each click selects its own body');
        assert.strictEqual(geometry.choose(regions, seed([shape.x - 3, 0])), left, label + ': just before actual junction');
        assert.strictEqual(geometry.choose(regions, seed([shape.x + 3, 0])), right, label + ': just after actual junction');
        assert.strictEqual(geometry.choose(regions, seed([0, 0])), left, label + ': repeated click keeps the same half');
        // The existing tail opening can trim an endpoint by one raster cell;
        // judge the final captured polygons within that sampling tolerance.
        const tolerance = geometry.raster([polygon]).scale / scale / stretch;
        for (const region of [left, right]) {
            const onJunction = region.polygons.flat().filter(point => Math.abs(originalX(point) - shape.x) <= tolerance);
            assert(onJunction.length >= 2, label + ': both halves follow the contour junction within one sampling cell');
        }
        for (const y of [-shape.y * .5, 0, shape.y * .5]) {
            for (const [offset, selected, other] of [[-3, left, right], [3, right, left]]) {
                const point = seed([shape.x + offset, y]);
                assert(geometry.contains(selected.polygons, point.x, point.y), label + ': owns its side of the join');
                assert(!geometry.contains(other.polygons, point.x, point.y), label + ': no overlapping capture at the join');
            }
        }
        const withHole = polygon.concat();
        const hole = Array.from({ length: 24 }, (_, i) => transform([4 * Math.cos(i * Math.PI / 12), 4 * Math.sin(i * Math.PI / 12)]));
        assert.equal(JSON.stringify(geometry.detect([withHole, hole])), JSON.stringify(regions), label + ': ink does not move the junction');
        assert.equal(JSON.stringify(geometry.detect([polygon])), JSON.stringify(regions), label + ': stable between clicks');
        cases++;
    }
}
const corridor = [[[0, 0], [120, 0], [120, 40], [180, 40], [180, 0], [300, 0], [300, 120], [180, 120], [180, 80], [120, 80], [120, 120], [0, 120]]];
const corridorRegions = geometry.detect(corridor);
assert.equal(corridorRegions.length, 2, 'ambiguous rectangular corridor retains two bodies');
const corridorLeft = geometry.choose(corridorRegions, { x: 60, y: 60 });
const corridorRight = geometry.choose(corridorRegions, { x: 240, y: 60 });
assert.strictEqual(geometry.choose(corridorRegions, { x: 140, y: 60 }), corridorLeft, 'no snapping to the wrong end of a corridor');
assert.strictEqual(geometry.choose(corridorRegions, { x: 170, y: 60 }), corridorRight, 'ambiguous join falls back to the established central split');
console.log(`Double bubble junction: ${cases} exact unequal/rotated/sheared joins, click ownership, parity of the two cuts and ink isolation PASS`);
