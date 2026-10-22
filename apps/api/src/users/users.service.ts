import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../common/entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  findByEmail(email: string, withPassword = false): Promise<User | null> {
    const query = this.users
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email });
    if (withPassword) query.addSelect('user.passwordHash');
    return query.getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  async create(email: string, passwordHash: string, displayName: string): Promise<User> {
    const user = this.users.create({
      email: email.trim().toLowerCase(),
      passwordHash,
      displayName: displayName.trim(),
    });
    return this.users.save(user);
  }
}
