/** 配信側の印が決まっていないとき（開発中など）の値。 */
export const UNSET_BUILD = 'development';

const known = (build: string | null | undefined): build is string => Boolean(build) && build !== UNSET_BUILD;

/** 両方の印が分かっていて、違うときだけ新しい版があるとみなす。 */
export const isNewerBuild = (running: string | null | undefined, served: string | null | undefined) => known(running) && known(served) && running !== served;
