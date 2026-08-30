/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { angleBetweenSegments, distanceBetween, intersectSegments, limitToCircle } from '../Helper';
import type { Point, Rect, RectPoints, Segment } from '../BasicTypes';
import { FlipCorner, FlipDirection } from './enums';
import { at } from '../arrayAccess';

/**
 * Class representing mathematical methods for calculating page position (rotation angle, clip area ...)
 */
export class FlipCalculation {
  /** Calculated rotation angle to flipping page */
  private angle = 0;
  /** Calculated position to flipping page */
  private position: Point = { x: 0, y: 0 };

  private rect: RectPoints = {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 0, y: 0 },
    bottomLeft: { x: 0, y: 0 },
    bottomRight: { x: 0, y: 0 },
  };

  /** The point of intersection of the page with the borders of the book */
  private topIntersectPoint: Point | null = null; // With top border
  private sideIntersectPoint: Point | null = null; // With side border
  private bottomIntersectPoint: Point | null = null; // With bottom border

  private readonly pageWidth: number;
  private readonly pageHeight: number;

  /**
   * The page's own geometry, which cannot change while a turn is in flight:
   * `pageWidth`/`pageHeight` are `readonly`, and a resize builds a new
   * `FlipCalculation`. These were rebuilt inside `calc()` — so on every pointer
   * move and every animation frame — and the three borders were additionally
   * written out twice each, once in the TOP branch and once in the BOTTOM one.
   *
   * Naming them here is the point; the saved work is a side effect. Nothing
   * downstream may mutate them: `intersectSegments` only reads its arguments
   * and returns a fresh point, so no border object ever escapes this class.
   */
  private readonly diagonal: number;
  private readonly boundRect: Rect;
  private readonly topBorder: Segment;
  private readonly sideBorder: Segment;
  private readonly bottomBorder: Segment;

  /**
   * @constructor
   *
   * @param {FlipDirection} direction - Flipping direction
   * @param {FlipCorner} corner - Flipping corner
   * @param pageWidth - Current page width
   * @param pageHeight - Current page height
   */
  constructor(
    private direction: FlipDirection,
    private corner: FlipCorner,
    pageWidth: number,
    pageHeight: number,
  ) {
    this.pageWidth = pageWidth;
    this.pageHeight = pageHeight;

    this.diagonal = Math.sqrt(pageWidth * pageWidth + pageHeight * pageHeight);
    this.boundRect = { left: -1, top: -1, width: pageWidth + 2, height: pageHeight + 2 };
    this.topBorder = [
      { x: 0, y: 0 },
      { x: pageWidth, y: 0 },
    ];
    this.sideBorder = [
      { x: pageWidth, y: 0 },
      { x: pageWidth, y: pageHeight },
    ];
    this.bottomBorder = [
      { x: 0, y: pageHeight },
      { x: pageWidth, y: pageHeight },
    ];
  }

  /**
   * The main calculation method
   *
   * @param {Point} localPos - Touch Point Coordinates (relative active page!)
   *
   * @returns {boolean} True - if the calculations were successful, false if errors occurred
   */
  public calc(localPos: Point): boolean {
    try {
      // Find: page rotation angle and active corner position
      this.position = this.calcAngleAndPosition(localPos);
      // Find the intersection points of the scrolling page and the book
      this.calculateIntersectPoint(this.position);

      return true;
    } catch {
      // Deliberately broad, and the one place in the engine that is.
      //
      // `calc` runs on every pointer move of a drag and uses exceptions as
      // control flow: the geometry guards below throw for a position that has
      // no valid fold, and `false` means "not a usable position, do not
      // advance". Distinguishing those from a genuine fault by type was tried
      // and measured — a marker class or a tagged error costs bundle bytes on
      // a hot path to catch something a consumer cannot act on mid-drag.
      // Elsewhere (`Flip.start`, `PageFlip.requestTurn`, the React navigation
      // paths) a non-`PageFlipError` propagates.
      return false;
    }
  }

  /**
   * Get the crop area for the flipping page
   *
   * @returns {Point[]} Polygon page
   */
  public getFlippingClipArea(): (Point | null)[] {
    const result: (Point | null)[] = [];
    let clipBottom = false;

    result.push(this.rect.topLeft);
    result.push(this.topIntersectPoint);

    if (this.sideIntersectPoint === null) {
      clipBottom = true;
    } else {
      result.push(this.sideIntersectPoint);

      if (this.bottomIntersectPoint === null) clipBottom = false;
    }

    result.push(this.bottomIntersectPoint);

    if (clipBottom || this.corner === FlipCorner.BOTTOM) {
      result.push(this.rect.bottomLeft);
    }

    return result;
  }

  /**
   * Get the crop area for the page that is below the page to be flipped
   *
   * @returns {Point[]} Polygon page
   */
  public getBottomClipArea(): (Point | null)[] {
    const result: (Point | null)[] = [];

    result.push(this.topIntersectPoint);

    if (this.corner === FlipCorner.TOP) {
      result.push({ x: this.pageWidth, y: 0 });
    } else {
      if (this.topIntersectPoint !== null) {
        result.push({ x: this.pageWidth, y: 0 });
      }
      result.push({ x: this.pageWidth, y: this.pageHeight });
    }

    if (this.sideIntersectPoint !== null && this.topIntersectPoint !== null) {
      if (distanceBetween(this.sideIntersectPoint, this.topIntersectPoint) >= 10) {
        result.push(this.sideIntersectPoint);
      }
    } else {
      if (this.corner === FlipCorner.TOP) {
        result.push({ x: this.pageWidth, y: this.pageHeight });
      }
    }

    result.push(this.bottomIntersectPoint);
    result.push(this.topIntersectPoint);

    return result;
  }

  /**
   * Get page rotation angle
   */
  public getAngle(): number {
    if (this.direction === FlipDirection.FORWARD) {
      return -this.angle;
    }

    return this.angle;
  }

  /**
   * Get page area while flipping
   */
  public getRect(): RectPoints {
    return this.rect;
  }

  /**
   * Get the position of the active angle when turning
   */
  public getPosition(): Point {
    return this.position;
  }

  /**
   * Get the active corner of the page (which pull)
   */
  public getActiveCorner(): Point {
    if (this.direction === FlipDirection.FORWARD) {
      return this.rect.topLeft;
    }

    return this.rect.topRight;
  }

  /**
   * Get flipping direction
   */
  public getDirection(): FlipDirection {
    return this.direction;
  }

  /**
   * Get flipping progress (0-100)
   */
  public getFlippingProgress(): number {
    return Math.abs(((this.position.x - this.pageWidth) / (2 * this.pageWidth)) * 100);
  }

  /**
   * Get flipping corner position (top, bottom)
   */
  public getCorner(): FlipCorner {
    return this.corner;
  }

  /**
   * Get start position for the page that is below the page to be flipped
   */
  public getBottomPagePosition(): Point {
    if (this.direction === FlipDirection.BACK) {
      return { x: this.pageWidth, y: 0 };
    }

    return { x: 0, y: 0 };
  }

  /**
   * Get the starting position of the shadow
   */
  public getShadowStartPoint(): Point | null {
    if (this.corner === FlipCorner.TOP) {
      return this.topIntersectPoint;
    } else {
      if (this.sideIntersectPoint !== null) return this.sideIntersectPoint;

      return this.topIntersectPoint;
    }
  }

  /**
   * Get the rotate angle of the shadow
   */
  public getShadowAngle(): number {
    const angle = angleBetweenSegments(this.getSegmentToShadowLine(), [
      { x: 0, y: 0 },
      { x: this.pageWidth, y: 0 },
    ]);

    if (this.direction === FlipDirection.FORWARD) {
      return angle;
    }

    return Math.PI - angle;
  }

  private calcAngleAndPosition(pos: Point): Point {
    let result = pos;

    this.updateAngleAndGeometry(result);

    if (this.corner === FlipCorner.TOP) {
      result = this.checkPositionAtCenterLine(result, { x: 0, y: 0 }, { x: 0, y: this.pageHeight });
    } else {
      result = this.checkPositionAtCenterLine(result, { x: 0, y: this.pageHeight }, { x: 0, y: 0 });
    }

    if (Math.abs(result.x - this.pageWidth) < 1 && Math.abs(result.y) < 1) {
      throw new Error('Point is too small');
    }

    return result;
  }

  private updateAngleAndGeometry(pos: Point): void {
    this.angle = this.calculateAngle(pos);
    this.rect = this.getPageRect(pos);
  }

  private calculateAngle(pos: Point): number {
    const left = this.pageWidth - pos.x + 1;
    const top = this.corner === FlipCorner.BOTTOM ? this.pageHeight - pos.y : pos.y;

    let angle = 2 * Math.acos(left / Math.sqrt(top * top + left * left));

    if (top < 0) angle = -angle;

    const da = Math.PI - angle;
    if (!isFinite(angle) || (da >= 0 && da < 0.003))
      throw new Error('The G point is too small to compute a fold angle');

    if (this.corner === FlipCorner.BOTTOM) angle = -angle;

    return angle;
  }

  private getPageRect(localPos: Point): RectPoints {
    if (this.corner === FlipCorner.TOP) {
      return this.getRectFromBasePoint(
        [
          { x: 0, y: 0 },
          { x: this.pageWidth, y: 0 },
          { x: 0, y: this.pageHeight },
          { x: this.pageWidth, y: this.pageHeight },
        ],
        localPos,
      );
    }

    return this.getRectFromBasePoint(
      [
        { x: 0, y: -this.pageHeight },
        { x: this.pageWidth, y: -this.pageHeight },
        { x: 0, y: 0 },
        { x: this.pageWidth, y: 0 },
      ],
      localPos,
    );
  }

  private getRectFromBasePoint(points: Point[], localPos: Point): RectPoints {
    return {
      topLeft: this.getRotatedPoint(at(points, 0), localPos),
      topRight: this.getRotatedPoint(at(points, 1), localPos),
      bottomLeft: this.getRotatedPoint(at(points, 2), localPos),
      bottomRight: this.getRotatedPoint(at(points, 3), localPos),
    };
  }

  /**
   * One rotation by `this.angle`. `cos`/`sin` were each evaluated twice per
   * point — eight of each per page rect, where two suffice — for a value that
   * cannot change between the two lines that read it. Same arithmetic, same
   * operand order, same bits out.
   */
  private getRotatedPoint(transformedPoint: Point, startPoint: Point): Point {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);

    return {
      x: transformedPoint.x * cos + transformedPoint.y * sin + startPoint.x,
      y: transformedPoint.y * cos - transformedPoint.x * sin + startPoint.y,
    };
  }

  private calculateIntersectPoint(pos: Point): void {
    const boundRect = this.boundRect;

    if (this.corner === FlipCorner.TOP) {
      this.topIntersectPoint = intersectSegments(
        boundRect,
        [pos, this.rect.topRight],
        this.topBorder,
      );

      this.sideIntersectPoint = intersectSegments(
        boundRect,
        [pos, this.rect.bottomLeft],
        this.sideBorder,
      );

      this.bottomIntersectPoint = intersectSegments(
        boundRect,
        [this.rect.bottomLeft, this.rect.bottomRight],
        this.bottomBorder,
      );
    } else {
      this.topIntersectPoint = intersectSegments(
        boundRect,
        [this.rect.topLeft, this.rect.topRight],
        this.topBorder,
      );

      this.sideIntersectPoint = intersectSegments(
        boundRect,
        [pos, this.rect.topLeft],
        this.sideBorder,
      );

      this.bottomIntersectPoint = intersectSegments(
        boundRect,
        [this.rect.bottomLeft, this.rect.bottomRight],
        this.bottomBorder,
      );
    }
  }

  private checkPositionAtCenterLine(checkedPos: Point, centerOne: Point, centerTwo: Point): Point {
    let result = checkedPos;

    const tmp = limitToCircle(centerOne, this.pageWidth, result);
    if (result !== tmp) {
      result = tmp;
      this.updateAngleAndGeometry(result);
    }

    let checkPointOne = this.rect.bottomRight;
    let checkPointTwo = this.rect.topLeft;

    if (this.corner === FlipCorner.BOTTOM) {
      checkPointOne = this.rect.topRight;
      checkPointTwo = this.rect.bottomLeft;
    }

    if (checkPointOne.x <= 0) {
      const bottomPoint = limitToCircle(centerTwo, this.diagonal, checkPointTwo);

      if (bottomPoint !== result) {
        result = bottomPoint;
        this.updateAngleAndGeometry(result);
      }
    }

    return result;
  }

  private getSegmentToShadowLine(): Segment {
    // Intersection points can be absent at the very start / end of a fold;
    // degenerate to the origin instead of throwing inside the angle math.
    const first = this.getShadowStartPoint() ?? { x: 0, y: 0 };

    const second =
      (first !== this.sideIntersectPoint && this.sideIntersectPoint !== null
        ? this.sideIntersectPoint
        : this.bottomIntersectPoint) ?? first;

    return [first, second];
  }
}
