import { Observable } from 'rxjs/Observable';

export type GetUrlFn = (url: string) => Observable<string | undefined>;
