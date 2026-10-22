import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AccountPlatform } from './account.types';

export class PushPlaylistDto {
  @IsIn(['netease', 'qq'], { message: '目标平台只支持网易云音乐和 QQ 音乐。' })
  platform: AccountPlatform;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;
}
