import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class AppleAuthorizeDto {
  @IsString({ message: '缺少 MusicKit 用户令牌。' })
  @MinLength(20, { message: '用户令牌看起来不完整。' })
  @MaxLength(4096)
  musicUserToken: string;

  @IsOptional()
  @IsString()
  @Length(2, 2, { message: '区号应为两位，例如 cn、us。' })
  storefront?: string;
}
