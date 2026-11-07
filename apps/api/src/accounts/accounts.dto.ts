import { IsIn, Matches, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AccountPlatform } from './account.types';

export class PushPlaylistDto {
  @IsIn(['netease', 'qq'], { message: '目标平台只支持网易云音乐和 QQ 音乐。' })
  platform: AccountPlatform;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;
}

export class ConnectCookieDto {
  @IsString()
  @MinLength(10, { message: 'Cookie 太短了，请复制完整的 Cookie。' })
  @MaxLength(8000, { message: 'Cookie 太长了，只要 MUSIC_U 和 __csrf 这几个字段。' })
  cookie: string;
}


export class StartNeteaseOAuthDto {
  @IsOptional()
  @IsString()
  @Matches(/^\/app(?:\/playlists\/[a-f\d-]{36})?$/i)
  returnTo?: string;
}

export class CompleteNeteaseOAuthDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9]{30}$/)
  state: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  code: string;
}
