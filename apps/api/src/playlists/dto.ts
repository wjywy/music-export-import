import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
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

export class AssignMatchDto {
  @IsIn(PLATFORMS, { message: '请选择目标平台。' })
  platform: Platform;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  remoteId?: string | null;

  @IsString({ message: '缺少目标曲目名。' })
  @MinLength(1)
  @MaxLength(250)
  remoteTitle: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  remoteArtist?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  remoteAlbum?: string | null;

  @IsOptional()
  @IsUrl({}, { message: '目标曲目链接格式不对。' })
  @MaxLength(900)
  remoteUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class SearchPlatformDto {
  @IsIn(PLATFORMS, { message: '请选择平台。' })
  platform: Platform;

  @IsString()
  @MinLength(1, { message: '请输入搜索关键词。' })
  @MaxLength(200)
  query: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;
}

export class MergePlaylistsDto {
  @IsArray()
  @ArrayMinSize(1, { message: '至少选择一张歌单。' })
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true, message: '歌单 ID 不对。' })
  playlistIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
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
