import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Platform, PLATFORMS } from '../common/platforms';

export class CreateImportDto {
  @IsString({ message: '请粘贴歌单链接。' })
  @MinLength(4, { message: '请粘贴完整的歌单链接。' })
  @MaxLength(2000)
  url: string;

  @IsOptional()
  @IsIn(PLATFORMS, { message: '目标平台不在支持范围内。' })
  targetPlatform?: Platform;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
