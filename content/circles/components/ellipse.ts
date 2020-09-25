// =============================================================================
// Ellipse Drawing Component
// (c) Mathigon
// =============================================================================


import {Circle, Point, Polyline} from '@mathigon/fermat';
import {$N, CanvasView, CustomElementView, register} from '@mathigon/boost';
import {Trail} from '../../chaos/components/simulation';
import {Geopad} from '../../shared/types';


function ellipsePts(a:number, b:number, h:number, k:number, n:number) {
  const pts = [];
  let t = 0;
  const dt = 2 * Math.PI / n;
  for (let i = 0; i < n; ++i) {
    pts.push(new Point(h + a * Math.cos(t), k + b * Math.sin(t)));
    t += dt;
  }
  return pts;
}

class RopeSegment {
  pos: Point;
  r: number;
  next: RopeSegment | null;
  prev: RopeSegment | null;
  pin: boolean;
  x0: number;   // saved position (for verlet integration)
  y0: number;
  selected: boolean;

  constructor(x:number, y:number, pin = false, r = 5) {
    this.pos = new Point(x, y);
    this.x0 = x;
    this.y0 = y;
    this.r = r; // radius for associated circle
    this.next = this.prev = null;
    this.pin = pin;
    this.selected = false;
  }

  moveTo(pt:Point) {
    this.pos = new Point(pt.x, pt.y);
  }

  constrainDistance(anchor:Point, distance:number, min:boolean) {
    const dv = this.pos.subtract(anchor);
    const d = dv.length;
    if (!min || d < distance) {
      this.pos = dv.unitVector.scale(distance).add(anchor);
    }
  }

  // the sense of advancing or reversing is defined by the clockwise parameter
  advance(clockwise:boolean):RopeSegment | null {
    return clockwise ? this.next : this.prev;
  }

  reverse(clockwise:boolean):RopeSegment | null {
    return clockwise ? this.prev : this.next;
  }
}

class RopeLoop {
  public segments: RopeSegment [];
  private lastgoodsegments: RopeSegment [];
  public selected: RopeSegment | null;

  private dx: number; // the fixed intersegment distance
  private f2: number; // distance multiplier for 2,3,4... step separations
  private constraintSegments = 5;

  constructor(points:Point[], n:number, dx:number, f2:number) {
    this.segments = [];
    // trying this idea - keep the last good and revert when a peg or the pen is jumped over
    this.lastgoodsegments = [];
    this.dx = dx;
    this.f2 = f2;
    this.selected = null;

    // make a segment for each point
    points.forEach(pt => this.segments.push(new RopeSegment(pt.x, pt.y)));
    // and connect them in a loop
    for (let i = 0; i < n; ++i) {
      const seg = this.segments[i];
      seg.next = this.segments[(i + 1) % n];
      seg.prev = this.segments[(n + i - 1) % n];
      this.lastgoodsegments[i] = new RopeSegment(seg.pos.x, seg.pos.y);
    }

    this.constrain();
    console.log('To find the code while debugging');
  }

  // TODO something to discourage loops would be nice here
  applyConstraintsInDirection(s:RopeSegment, clockwise:boolean) {
    let count = this.segments.length; // once around if no selection
    while (count--) {
      s = s.advance(clockwise) as RopeSegment;
      if (!s || s.selected) {
        break;
      }
      let k = 0;
      let t = s.reverse(clockwise);
      while (t && (++k < this.constraintSegments)) {
        s.constrainDistance(t.pos, k == 1 ? this.dx : k * this.f2 * this.dx, k != 1);
        t = t.reverse(clockwise);
      }
    }
  }

  // find closest segment to the given point - must be at least as close as tol
  selectSegmentAt(p:Point, tol:number) {
    this.selected = null;
    const tolsq = tol * tol;
    this.selected = this.segments.reduce((a, b) => {
      const da = a.pos.subtract(p).length;
      const db = b.pos.subtract(p).length;
      const aisless = da < db;
      a.selected = aisless && da < tolsq;
      b.selected = !aisless && db < tolsq;
      return aisless ? a : b;
    });
    // was the closest segment within the tolerance?
    return this.selected.selected ? this.selected : null;
  }

  constrain() {
    const s = this.selected || this.segments[0];
    this.applyConstraintsInDirection(s, true);
    this.applyConstraintsInDirection(s, false);
  }

  savelastgood() {
    for (let i = 0; i < this.segments.length; ++i) {
      this.lastgoodsegments[i].moveTo(this.segments[i].pos);
    }
  }

  restorelastgood() {
    for (let i = 0; i < this.segments.length; ++i) {
      this.segments[i].moveTo(this.lastgoodsegments[i].pos);
    }
  }

  vertices() {
    return this.segments.map(s => s.pos);
  }
}

// TODO I expect there is a function to do this already somewhere...
function isPointInPoly(pt:Point, vertices:Point[]) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    const intersect = ((yi > pt.y) != (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

@register('x-ellipse')
export class Ellipse extends CustomElementView {

  ready() {
    const $geopad = this.$('x-geopad') as Geopad;
    const $canvas = $N('canvas', {width: 1200, height: 800}) as CanvasView;
    $canvas.css({position: 'absolute', width: '100%', height: '100%'});
    $geopad.prepend($canvas);
    const trail = new Trail('path', 'ccc', 4, 400);

    const stringLength = 8;

    /*
      x-geopad(width=600 height=400 x-axis="-6,6,1" y-axis="-4,4,1"): svg.r
        circle.move(name="a" x="point(-2,0)" project="segment(point(-4,0),point(-0.5,0))")
        circle.move(name="b" x="point(2,0)" project="segment(point(0.5,0),point(4,0))")
    */

    // ellipse parameters
    const a = stringLength / 2;  // Parameter a of ellipse.
    const c = 2; // Half focus separation
    const b = Math.sqrt(a ** 2 - c ** 2);  // Parameter b of ellipse.
    const h = 0;
    const k = 0;
    const n = 160;

    // TODO the total length is 2 * (a + c) - but will need to adjust because it's a loop
    const dx = 2 * (a + c) / n;
    const f = 0.5;

    const points = ellipsePts(a / 0.9, b / 2, h, k, n);
    const rope = new RopeLoop(points, n, dx, f);

    // Draw the pen point.
    const pen = $geopad.drawPoint(new Point(0, 0),
        {interactive: true, name: 'c', classes: 'red'});
    let lastPenPosition = new Point(0, 0);
    // FIXME when I try to adjust the pen position I am getting max stack errors
    // let savepen:Point = new Point(0, 0);

    const pegs = [
      new Circle(new Point(-2, 0), 1),
      new Circle(new Point(2, 0), 1)
    ];

    function manageConstraintsAndCollisions(rope:RopeLoop, obstacles:Circle[], curPen:Point) {
      // save any rope selection
      const saveSelected = rope.selected;

      // manage the collision constraints
      obstacles.forEach(o => {
        const influence = 0.5;// o.r + 0.2;
        for (let i = 0; i < 10; ++i) {
          const selected = rope.selectSegmentAt(o.c, influence);
          if (!selected) {
            break;
          }
          selected.constrainDistance(o.c, influence, true);
          rope.constrain();
        }
      });

      // restore the selection
      rope.selected = saveSelected;
      if (rope.selected) {
        rope.selected.selected = true;
      }
      rope.constrain();

      // validation
      // do not allow then pen or either of the pegs out of the curve
      if ([curPen, pegs[0].c, pegs[1].c].every(q => isPointInPoly(q, rope.vertices()))) {
        // FIXME the saving and restoring is not working
        // rope.savelastgood();
        // FIXME - how to handle the pen restoration?
        // savepen = new Point(curPen.x, curPen.y);
      } else {
        // rope.restorelastgood();
        // FIXME
        // pen.setValue(new Point(savepen.x, savepen.y));
      }
    }

    // Draw a new path that connects the foci and pencil position.
    $geopad.drawPath((s: any) => {

      // break up large moves
      const maxmove = 2;
      let movex = s.c.x - lastPenPosition.x;
      let movey = s.c.y - lastPenPosition.y;
      const r = 0.2;
      let penpos = new Circle(lastPenPosition, r);
      pegs[0] = new Circle(s.a, r);
      pegs[1] = new Circle(s.b, r);
      do {
        const stepx = Math.min(movex, maxmove);
        const stepy = Math.min(movey, maxmove);
        penpos = penpos.shift(stepx, stepy);
        manageConstraintsAndCollisions(rope, [...pegs, penpos], penpos.c);
        // make it draw here?
        movex -= stepx;
        movey -= stepy;
      } while (movex > 0 && movey > 0);
      lastPenPosition = new Point(s.c.x, s.c.y);

      // manageConstraintsAndCollisions(rope, [new Circle(s.a, 1), new Circle(s.b, 1), new Circle(s.c, 1)]);
      // TODO >>> Calculate true string position <<<
      // return new Polygon(s.a, s.b, s.c);
      return new Polyline(...rope.segments.map(s => s.pos), rope.segments[0].pos);
    }, {classes: 'blue'});

    // Restrict the position of the pen to within the ellipse.
    $geopad.model.watch((s: any) => {
      const p = pen.value!;
      const d = Point.distance(p, s.a) + Point.distance(p, s.b);

      if (d > stringLength) {
        const c = Point.distance(s.a, s.b) / 2;  // Half distance between foci.
        const a = stringLength / 2;  // Parameter a of ellipse.
        const b = Math.sqrt(a ** 2 - c ** 2);  // Parameter b of ellipse.
        const th = p.angle(Point.average(s.a, s.b));  // Angle of pen.
        pen.setValue(new Point(a * Math.cos(th), b * Math.sin(th)));
      }
    });

    // Draw a pencil trail whenever model.c changes.
    $geopad.model.watch((s: any) => {
      $canvas.clear();
      trail.push($geopad.toViewportCoords(s.c));
      trail.draw($canvas);
    });
  }
}
