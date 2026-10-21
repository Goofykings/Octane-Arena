/** Hoops-only actor membership. Other modes retain their existing masks. */
export const HOOPS_CAR_GROUP = 0x0001ffff;
export const HOOPS_BALL_GROUP = 0x0002ffff;
export const HOOPS_RIM_GROUP = 0x0020ffff; // Physical for cars/ball; ignored by camera queries.
export const HOOPS_NET_GROUP = 0x00040002; // Membership 4, filter: ball membership 2 only.

/** Dropshot actors keep distinct membership; support is invisible to the ball. */
export const DROPSHOT_CAR_GROUP = 0x0001ffff;
export const DROPSHOT_BALL_GROUP = 0x0002ffff;
export const DROPSHOT_SUPPORT_GROUP = 0x00080001;
export const DROPSHOT_TILE_GROUP = 0x00100002;
