import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
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

export class BatchImportDto {
  @IsArray({ message: '请提供链接列表。' })
  @ArrayMinSize(1, { message: '至少粘贴一个链接。' })
  @ArrayMaxSize(10, { message: '一次最多合并 10 个链接。' })
  @IsString({ each: true })
  @MaxLength(900, { each: true })
  urls: string[];

  @IsOptional()
  @IsIn(PLATFORMS, { message: '目标平台不在支持范围内。' })
  targetPlatform?: Platform;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
