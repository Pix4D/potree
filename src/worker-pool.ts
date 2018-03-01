export class WorkerPool {
  workers = new Map<string, Worker[]>();

  getWorker(url: string) {
    const workersForUrl = this.getListFor(url);

    if (workersForUrl.length === 0) {
      return new Worker(url);
    } else {
      return workersForUrl.pop();
    }
  }

  returnWorker(url: string, worker: Worker) {
    this.getListFor(url).push(worker);
  }

  private getListFor(url: string): Worker[] {
    let workersForUrl = this.workers.get(url);

    if (!workersForUrl) {
      workersForUrl = [];
      this.workers.set(url, workersForUrl);
    }

    return workersForUrl;
  }
}
