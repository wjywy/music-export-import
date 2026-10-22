import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Platform, PLATFORMS, Visibility } from '../common/platforms';

export class CreatePlaylistItemDto {
  @IsString({ message: '曲名不能为空。' })
  @MinLength(1, { message: '曲名不能为空。' })
  @MaxLength(250)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  artist?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  album?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  durationMs?: number | null;

  @IsOptional()
  @IsIn(PLATFORMS)
  sourcePlatform?: Platform | null;

  @IsOptional()
  @IsUrl({}, { message: '曲目链接格式不对。' })
  @MaxLength(900)
  sourceUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  isrc?: string | null;
}

export class CreatePlaylistDto {
  @IsString({ message: '给歌单起个名字吧。' })
  @MinLength(1, { message: '给歌单起个名字吧。' })
  @MaxLength(200, { message: '歌单名最多 200 个字符。' })
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsIn(['private', 'unlisted', 'public'])
  visibility?: Visibility;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500, { message: '一次最多 500 首。' })
  @ValidateNested({ each: true })
  @Type(() => CreatePlaylistItemDto)
  items?: CreatePlaylistItemDto[];
}

export class UpdatePlaylistDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: '歌单名不能为空。' })
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsIn(['private', 'unlisted', 'public'])
  visibility?: Visibility;
}

export class AddItemsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CreatePlaylistItemDto)
  items: CreatePlaylistItemDto[];
}

export class MatchDto {
  @IsIn(PLATFORMS, { message: '请选择一个目标平台。' })
  platform: Platform;

  @IsOptional()
  @IsNumber()
  @Min(0.4)
  @Max(1)
  threshold?: number;
}
