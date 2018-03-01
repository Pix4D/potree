type Node = {
  id: string;
  loaded: boolean;
  numPoints: number;
  children: Node[];
  dispose(): void;
};

export class LRUItem {
  next: LRUItem | null;
  previous: LRUItem | null;
  constructor(public node: Node) {}
}

/**
 * A doubly-linked-list of the least recently used elements.
 */
export class LRU {
  // the least recently used item
  first: LRUItem | null = null;
  // the most recently used item
  last: LRUItem | null = null;
  numPoints: number = 0;

  private items = new Map<string, LRUItem>();

  constructor(private pointLoadLimit: number = 1_000_000) {}

  get size(): number {
    return this.items.size;
  }

  has(node: Node): boolean {
    return this.items.has(node.id);
  }

  /**
   * Makes the specified the most recently used item. if the list does not contain node, it will
   * be added.
   */
  touch(node: Node) {
    if (!node.loaded) {
      return;
    }

    let item = this.items.get(node.id);
    if (!item) {
      // add to list
      item = new LRUItem(node);
      item.previous = this.last;
      this.last = item;
      if (item.previous) {
        item.previous.next = item;
      }

      this.items.set(node.id, item);

      if (!this.first) {
        this.first = item;
      }
      this.numPoints += node.numPoints;
    }

    if (!item.previous) {
      // handle touch on first element
      if (item.next) {
        this.first = item.next;
        this.first.previous = null;
        item.previous = this.last;
        item.next = null;
        this.last = item;

        if (item.previous) {
          item.previous.next = item;
        }
      }
    } else if (!item.next) {
      // handle touch on last element
    } else {
      // handle touch on any other element
      item.previous.next = item.next;
      item.next.previous = item.previous;
      item.previous = this.last;
      item.next = null;
      this.last = item;

      if (item.previous) {
        item.previous.next = item;
      }
    }
  }

  remove(node: Node) {
    const item = this.items.get(node.id);
    if (!item) {
      return;
    }

    if (this.items.size === 1) {
      this.first = null;
      this.last = null;
    } else {
      if (!item.previous) {
        this.first = item.next;

        if (this.first) {
          this.first.previous = null;
        }
      }

      if (!item.next) {
        this.last = item.previous;

        if (this.last) {
          this.last.next = null;
        }
      }

      if (item.previous && item.next) {
        item.previous.next = item.next;
        item.next.previous = item.previous;
      }
    }

    this.items.delete(node.id);
    this.numPoints -= node.numPoints;
  }

  getLRUItem(): Node | undefined {
    return this.first ? this.first.node : undefined;
  }

  freeMemory(): void {
    if (this.items.size <= 1) {
      return;
    }

    while (this.numPoints > this.pointLoadLimit) {
      const node = this.getLRUItem();
      if (node) {
        this.disposeDescendants(node);
      }
    }
  }

  disposeDescendants(node: Node): void {
    const stack: Node[] = [node];

    let current: Node | undefined;
    while ((current = stack.pop())) {
      current.dispose();
      this.remove(current);

      current.children.forEach(child => {
        if (child && child.loaded) {
          stack.push(child);
        }
      });
    }
  }
}
