/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Render } from '../Render/Render';
import type { Point } from '../BasicTypes';

/**
 * State of the page on the basis of which rendering
 */
export interface PageState {
  /** Page rotation angle */
  angle: number;

  /** Page scope. `null` entries are skipped by the renderers. */
  area: (Point | null)[];

  /** Page position */
  position: Point;

  /** Rotate angle for hard pages */
  hardAngle: number;

  /** Rotate angle for hard pages at renedering time */
  hardDrawingAngle: number;
}

export const PageOrientation = {
  LEFT: 0,
  RIGHT: 1,
} as const;
export type PageOrientation = (typeof PageOrientation)[keyof typeof PageOrientation];

export const PageDensity = {
  SOFT: 'soft',
  HARD: 'hard',
} as const;
export type PageDensity = (typeof PageDensity)[keyof typeof PageDensity];

/**
 * Class representing a book page
 */
export abstract class Page {
  /** State of the page on the basis of which rendering */
  protected state: PageState;
  /** Render object */
  protected render: Render;

  /** Page Orientation */
  protected orientation: PageOrientation = PageOrientation.RIGHT;

  /** Density at creation */
  protected createdDensity: PageDensity;
  /** Density at the time of rendering (Depends on neighboring pages) */
  protected nowDrawingDensity: PageDensity;

  protected constructor(render: Render, density: PageDensity) {
    this.state = {
      angle: 0,
      area: [],
      position: { x: 0, y: 0 },
      hardAngle: 0,
      hardDrawingAngle: 0,
    };

    this.createdDensity = density;
    this.nowDrawingDensity = this.createdDensity;

    this.render = render;
  }

  /**
   * Render static page
   *
   * @param {PageOrientation} orient - Static page orientation
   */
  public abstract simpleDraw(orient: PageOrientation): void;

  /**
   * Render dynamic page, using state
   *
   * @param {PageDensity} tempDensity - Density at the time of rendering
   */
  public abstract draw(tempDensity?: PageDensity): void;

  /**
   * Page loading
   */
  public abstract load(): void;

  /**
   * Set a constant page density
   *
   * @param {PageDensity} density
   */
  public setDensity(density: PageDensity): void {
    this.createdDensity = density;
    this.nowDrawingDensity = density;
  }

  /**
   * Set temp page density to next render
   *
   * @param {PageDensity}  density
   */
  public setDrawingDensity(density: PageDensity): void {
    this.nowDrawingDensity = density;
  }

  /**
   * Set page position
   *
   * @param {Point} pagePos
   */
  public setPosition(pagePos: Point): void {
    this.state.position = pagePos;
  }

  /**
   * Set page angle
   *
   * @param {number} angle
   */
  public setAngle(angle: number): void {
    this.state.angle = angle;
  }

  /**
   * Set page crop area
   *
   * @param {Point[]} area
   */
  public setArea(area: (Point | null)[]): void {
    this.state.area = area;
  }

  /**
   * Rotate angle for hard pages to next render
   *
   * @param {number} angle
   */
  public setHardDrawingAngle(angle: number): void {
    this.state.hardDrawingAngle = angle;
  }

  /**
   * Rotate angle for hard pages
   *
   * @param {number} angle
   */
  public setHardAngle(angle: number): void {
    this.state.hardAngle = angle;
    this.state.hardDrawingAngle = angle;
  }

  /**
   * Set page orientation
   *
   * @param {PageOrientation} orientation
   */
  public setOrientation(orientation: PageOrientation): void {
    this.orientation = orientation;
  }

  /**
   * Get temp page density
   */
  public getDrawingDensity(): PageDensity {
    return this.nowDrawingDensity;
  }

  /**
   * Get a constant page density
   */
  public getDensity(): PageDensity {
    return this.createdDensity;
  }

  /**
   * Get rotate angle for hard pages
   */
  public getHardAngle(): number {
    return this.state.hardAngle;
  }

  /**
   * Release anything the page owns beyond its own object graph.
   *
   * Default is a no-op — an `HTMLPage` borrows a node the host owns. An
   * `ImagePage` owns a decoded bitmap and pending load callbacks, so it
   * overrides this.
   */
  public dispose(): void {
    this.hideTemporaryCopy();
  }

  public abstract newTemporaryCopy(): Page;
  public abstract getTemporaryCopy(): Page | null;
  public abstract hideTemporaryCopy(): void;
}
